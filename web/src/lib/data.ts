import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi, getAbiItem, type Address, type Hex } from "viem";
import { getLogsChunked, leashVaultAbi, payeeRegistryAbi } from "@leash/shared";
import { cfg, configured, publicClient } from "./config";

export interface LeashInfo {
  id: bigint;
  owner: Address;
  agent: Address;
  expiresAt: number;
  vetoWindow: number;
  revoked: boolean;
  balance: bigint;
  reserved: bigint;
  autoLimit: bigint;
  maxPerInvoice: bigint;
  dailyCap: bigint;
  spentInWindow: bigint;
  windowStart: number;
  remainingToday: bigint;
}

export interface PayeeInfo {
  id: bigint;
  owner: Address;
  payout: Address;
  pendingPayout: Address;
  changeReadyAt: number;
  active: boolean;
  identityId: bigint;
  name: string;
  domain: string;
  payable: boolean;
  allowed: boolean;
}

export interface PaymentInfo {
  id: bigint;
  payeeId: bigint;
  amount: bigint;
  executeAfter: number;
  status: "queued" | "paid" | "vetoed" | "void";
  invoiceRef: Hex;
  memo: string;
  proposedTx: Hex;
  proposedBlock: bigint;
  paidTx?: Hex;
  pending: boolean;
  payeeChanged: boolean;
}

export interface HistoryRow {
  kind: "proposed" | "paid" | "vetoed";
  paymentId: bigint;
  block: bigint;
  tx: Hex;
  time?: number;
}

export interface AgentHealth {
  ok: boolean;
  agent: Address;
  agentGas: string;
  leashId: string;
  llm: boolean;
  allowedPayees?: { id: string; name: string; domain: string; payable: boolean }[];
  keeper: { lastRun?: string; lastError?: string; watching: number };
}

const ev = {
  created: getAbiItem({ abi: leashVaultAbi, name: "LeashCreated" }),
  proposed: getAbiItem({ abi: leashVaultAbi, name: "PaymentProposed" }),
  executed: getAbiItem({ abi: leashVaultAbi, name: "PaymentExecuted" }),
  vetoed: getAbiItem({ abi: leashVaultAbi, name: "PaymentVetoed" }),
  registered: getAbiItem({ abi: payeeRegistryAbi, name: "PayeeRegistered" }),
};

/** Remembers which blocks were already scanned, so each poll only reads new blocks (Aevum: 1,000 per call). */
class LogCache<T> {
  items: T[] = [];
  next: bigint;
  private lock: Promise<void> = Promise.resolve();
  constructor(start: bigint) {
    this.next = start;
  }
  /** Serialised: overlapping polls must not read (and append) the same block range twice. */
  update(head: bigint, fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<void> {
    const run = this.lock.then(async () => {
      if (head < this.next) return;
      const got = await fetch(this.next, head);
      this.items.push(...got);
      this.next = head + 1n;
    });
    this.lock = run.catch(() => {});
    return run;
  }
}

export interface ChainData {
  loading: boolean;
  error?: string;
  now: number;
  myLeashes: LeashInfo[];
  leash?: LeashInfo;
  payees: PayeeInfo[];
  payments: PaymentInfo[];
  history: HistoryRow[];
  gas: bigint;
  tokenBalance: bigint;
  agent?: AgentHealth;
  refresh: () => void;
}

export function useChainData(account: Address | undefined, selected: bigint | undefined): ChainData {
  const [state, setState] = useState<Omit<ChainData, "refresh">>({
    loading: true,
    now: Math.floor(Date.now() / 1000),
    myLeashes: [],
    payees: [],
    payments: [],
    history: [],
    gas: 0n,
    tokenBalance: 0n,
  });
  const caches = useRef<{ key: string; created: LogCache<{ id: bigint; owner: Address }>; payees: LogCache<bigint>; proposed: LogCache<{ id: bigint; leashId: bigint; memo: string; tx: Hex; block: bigint }>; executed: LogCache<{ id: bigint; tx: Hex; block: bigint }>; vetoed: LogCache<{ id: bigint; tx: Hex; block: bigint }> } | null>(null);
  const blockTimes = useRef(new Map<bigint, number>());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const agent = await fetch(`${cfg.agentUrl}/api/health`, { signal: AbortSignal.timeout(4000) })
        .then((r) => (r.ok ? (r.json() as Promise<AgentHealth>) : undefined))
        .catch(() => undefined);
      if (!configured) {
        setState((s) => ({ ...s, loading: false, agent, error: "not-configured" }));
        return;
      }
      const key = "v1";
      if (!caches.current || caches.current.key !== key) {
        caches.current = {
          key,
          created: new LogCache(cfg.startBlock),
          payees: new LogCache(cfg.startBlock),
          proposed: new LogCache(cfg.startBlock),
          executed: new LogCache(cfg.startBlock),
          vetoed: new LogCache(cfg.startBlock),
        };
      }
      const c = caches.current;
      const vault = cfg.vault!;
      const registry = cfg.registry!;
      const block = await publicClient.getBlock();
      const head = block.number;
      const now = Number(block.timestamp);

      await Promise.all([
        c.created.update(head, async (from, to) =>
          (await getLogsChunked(publicClient, { address: vault, event: ev.created, fromBlock: from, toBlock: to })).map(
            (l) => ({ id: l.args.leashId!, owner: l.args.owner! }),
          ),
        ),
        c.payees.update(head, async (from, to) =>
          (await getLogsChunked(publicClient, { address: registry, event: ev.registered, fromBlock: from, toBlock: to })).map(
            (l) => l.args.payeeId!,
          ),
        ),
        c.proposed.update(head, async (from, to) =>
          (await getLogsChunked(publicClient, { address: vault, event: ev.proposed, fromBlock: from, toBlock: to })).map(
            (l) => ({ id: l.args.paymentId!, leashId: l.args.leashId!, memo: l.args.memo ?? "", tx: l.transactionHash!, block: l.blockNumber! }),
          ),
        ),
        c.executed.update(head, async (from, to) =>
          (await getLogsChunked(publicClient, { address: vault, event: ev.executed, fromBlock: from, toBlock: to })).map(
            (l) => ({ id: l.args.paymentId!, tx: l.transactionHash!, block: l.blockNumber! }),
          ),
        ),
        c.vetoed.update(head, async (from, to) =>
          (await getLogsChunked(publicClient, { address: vault, event: ev.vetoed, fromBlock: from, toBlock: to })).map(
            (l) => ({ id: l.args.paymentId!, tx: l.transactionHash!, block: l.blockNumber! }),
          ),
        ),
      ]);

      const mine = account ? c.created.items.filter((x) => x.owner.toLowerCase() === account.toLowerCase()) : [];
      const myLeashes = await Promise.all(mine.map((m) => readLeash(m.id)));
      const fallback = agent ? BigInt(agent.leashId) : undefined;
      const activeId = selected ?? myLeashes.at(-1)?.id ?? fallback;
      const leash = activeId ? (myLeashes.find((l) => l.id === activeId) ?? (await readLeash(activeId))) : undefined;

      const payees = await Promise.all(
        c.payees.items.map(async (id) => {
          const [p, [, payable], allowed] = await Promise.all([
            publicClient.readContract({ address: registry, abi: payeeRegistryAbi, functionName: "getPayee", args: [id] }),
            publicClient.readContract({ address: registry, abi: payeeRegistryAbi, functionName: "payoutOf", args: [id] }),
            leash
              ? publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "payeeAllowed", args: [leash.id, id] })
              : Promise.resolve(false),
          ]);
          return {
            id,
            owner: p.owner,
            payout: p.payout,
            pendingPayout: p.pendingPayout,
            changeReadyAt: Number(p.changeReadyAt),
            active: p.active,
            identityId: p.identityId,
            name: p.name,
            domain: p.domain,
            payable,
            allowed,
          } satisfies PayeeInfo;
        }),
      );

      const ofLeash = leash ? c.proposed.items.filter((p) => p.leashId === leash.id) : [];
      const ids = new Set(ofLeash.map((p) => p.id));
      const paidTx = new Map(c.executed.items.filter((e) => ids.has(e.id)).map((e) => [e.id, e]));
      const vetoTx = new Map(c.vetoed.items.filter((e) => ids.has(e.id)).map((e) => [e.id, e]));
      const payments = await Promise.all(
        ofLeash.map(async (p) => {
          const raw = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "payments", args: [p.id] });
          const status = raw[7];
          const pending = status === 1 && !leash!.revoked && now < leash!.expiresAt;
          const payee = payees.find((x) => x.id === raw[1]);
          return {
            id: p.id,
            payeeId: raw[1],
            amount: raw[3],
            executeAfter: Number(raw[5]),
            status: status === 2 ? "paid" : status === 3 ? "vetoed" : pending ? "queued" : "void",
            invoiceRef: raw[8],
            memo: p.memo,
            proposedTx: p.tx,
            proposedBlock: p.block,
            paidTx: paidTx.get(p.id)?.tx,
            pending,
            payeeChanged: pending && Boolean(payee) && (!payee!.payable || payee!.payout.toLowerCase() !== raw[2].toLowerCase()),
          } satisfies PaymentInfo;
        }),
      );

      const history: HistoryRow[] = [
        ...ofLeash.map((p) => ({ kind: "proposed" as const, paymentId: p.id, block: p.block, tx: p.tx })),
        ...[...paidTx.values()].map((e) => ({ kind: "paid" as const, paymentId: e.id, block: e.block, tx: e.tx })),
        ...[...vetoTx.values()].map((e) => ({ kind: "vetoed" as const, paymentId: e.id, block: e.block, tx: e.tx })),
      ].sort((a, b) => (b.block === a.block ? (a.kind === "proposed" ? 1 : -1) : Number(b.block - a.block)));
      for (const h of history.slice(0, 60)) {
        if (!blockTimes.current.has(h.block)) {
          const b = await publicClient.getBlock({ blockNumber: h.block });
          blockTimes.current.set(h.block, Number(b.timestamp));
        }
      }
      history.forEach((h) => (h.time = blockTimes.current.get(h.block)));

      const [gas, tokenBalance] = account
        ? await Promise.all([
            publicClient.getBalance({ address: account }),
            publicClient.readContract({ address: cfg.token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          ])
        : [0n, 0n];

      if (!cancelled) {
        setState({ loading: false, now, myLeashes, leash, payees, payments, history, gas, tokenBalance, agent, error: undefined });
      }
    }
    load().catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: (e as Error).message })));
    const timer = setInterval(() => load().catch(() => {}), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [account, selected, tick]);

  return { ...state, refresh };
}

async function readLeash(id: bigint): Promise<LeashInfo> {
  const vault = cfg.vault!;
  const [l, remainingToday] = await Promise.all([
    publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "leashes", args: [id] }),
    publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "remainingToday", args: [id] }),
  ]);
  return {
    id,
    owner: l[0],
    agent: l[1],
    expiresAt: Number(l[2]),
    vetoWindow: Number(l[3]),
    revoked: l[4],
    balance: l[5],
    reserved: l[6],
    autoLimit: l[7],
    maxPerInvoice: l[8],
    dailyCap: l[9],
    spentInWindow: l[10],
    windowStart: Number(l[11]),
    remainingToday,
  };
}
