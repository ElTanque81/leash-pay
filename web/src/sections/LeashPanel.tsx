import { useEffect, useState } from "react";
import { erc20Abi, isAddress, parseUnits, toHex, type Address } from "viem";
import { leashVaultAbi } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg, chain, publicClient } from "../lib/config";
import { fmtDate, fmtDuration, fmtUsd } from "../lib/tx";
import { Field, Section } from "./ui";

const toUnits = (s: string) => {
  try {
    return parseUnits(s.replace(",", ".") || "0", 6);
  } catch {
    return 0n;
  }
};
const fromUnits = (v: bigint) => (Number(v) / 1e6).toString();

export function LeashPanel() {
  const { t, lang } = useT();
  const { wallet, data, tx, selectLeash } = useApp();
  const l = data.leash;
  const isOwner = Boolean(l && wallet.account?.toLowerCase() === l.owner.toLowerCase());
  const editable = isOwner && l && !l.revoked && data.now < l.expiresAt;

  // Demo defaults sized for the faucet's 5 tUSD8.
  const [agent, setAgent] = useState("");
  const [instant, setInstant] = useState("0.5");
  const [max, setMax] = useState("2");
  const [day, setDay] = useState("3");
  const [veto, setVeto] = useState("2");
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("4");

  useEffect(() => {
    if (l && isOwner) {
      setAgent(l.agent);
      setInstant(fromUnits(l.autoLimit));
      setMax(fromUnits(l.maxPerInvoice));
      setDay(fromUnits(l.dailyCap));
      setVeto(String(Math.round(l.vetoWindow / 60)));
    } else if (!agent && data.agent?.agent) {
      setAgent(data.agent.agent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l?.id, data.agent?.agent]);

  const preview = t.preview({
    instant: fmtUsd(toUnits(instant), lang),
    max: fmtUsd(toUnits(max), lang),
    day: fmtUsd(toUnits(day), lang),
    veto: fmtDuration(Number(veto) * 60, lang),
    days,
  });
  const limitsArgs = () =>
    [
      agent as Address,
      toUnits(instant),
      toUnits(max),
      toUnits(day),
      BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400),
      Number(veto) * 60,
    ] as const;

  async function create() {
    await tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "createLeash", args: limitsArgs() }, t.done);
  }
  async function save() {
    await tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "updateLeash", args: [l!.id, ...limitsArgs()] }, t.done);
  }
  async function fund() {
    const v = toUnits(amount);
    const allowance = await publicClient.readContract({
      address: cfg.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet.account!, cfg.vault!],
    });
    if (allowance < v) {
      const ok = await tx.send({ address: cfg.token, abi: erc20Abi, functionName: "approve", args: [cfg.vault!, v] }, "✓ approve");
      if (!ok) return;
    }
    await tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "fund", args: [l!.id, v] }, t.done);
  }
  async function fundGasless() {
    if (!wallet.client?.account || !l) return;
    const value = toUnits(amount);
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
    tx.setNotice({ kind: "working", text: t.confirmInWallet });
    try {
      const signature = await wallet.client.signTypedData({
        account: wallet.client.account,
        domain: { name: "tUSD8", version: "2", chainId: chain.id, verifyingContract: cfg.token },
        types: {
          ReceiveWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "ReceiveWithAuthorization",
        message: { from: wallet.account!, to: cfg.vault!, value, validAfter: 0n, validBefore, nonce },
      });
      const res = await fetch(`${cfg.agentUrl}/api/relay/fund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leashId: l.id.toString(),
          from: wallet.account,
          amount: value.toString(),
          validAfter: "0",
          validBefore: validBefore.toString(),
          nonce,
          signature,
          lang,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      tx.setNotice({ kind: "ok", text: t.done, link: body.explorer });
      data.refresh();
    } catch (e) {
      tx.setNotice({ kind: "error", text: (e as Error).message });
    }
  }
  const free = l ? (l.revoked || data.now >= l.expiresAt ? l.balance : l.balance - l.reserved) : 0n;

  async function withdraw() {
    const want = toUnits(amount);
    const v = want > 0n && want < free ? want : free; // more than available: take what is free
    await tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "withdraw", args: [l!.id, v] }, t.done);
  }

  return (
    <Section
      title={t.leashTitle}
      lead={t.leashLead}
      aside={
        data.myLeashes.length > 1 && (
          <select value={l?.id.toString()} onChange={(e) => selectLeash(BigInt(e.target.value))} aria-label="Leash">
            {data.myLeashes.map((x) => (
              <option key={x.id.toString()} value={x.id.toString()}>
                {t.leashNo(x.id.toString())}
              </option>
            ))}
          </select>
        )
      }
    >
      {l && (
        <dl className="figures">
          <div>
            <dt>{t.balance}</dt>
            <dd className="num">{fmtUsd(l.balance, lang)}</dd>
          </div>
          <div>
            <dt>{t.reserved}</dt>
            <dd className="num">{fmtUsd(l.reserved, lang)}</dd>
          </div>
          <div>
            <dt>{t.agentAddress}</dt>
            <dd className="mono">{l.agent}</dd>
          </div>
          <div>
            <dt>{t.runsUntil}</dt>
            <dd>{fmtDate(l.expiresAt, lang, false)}</dd>
          </div>
        </dl>
      )}

      {isOwner && l && (
        <div className="row-form">
          <Field label={t.amount}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {!l.revoked && (
            <>
              <button className="primary" onClick={fund} disabled={tx.busy}>
                {t.fund}
              </button>
              <button onClick={fundGasless} disabled={tx.busy || !data.agent} title={t.fundGaslessHint}>
                {t.fundGasless}
              </button>
            </>
          )}
          <button className="ghost" onClick={withdraw} disabled={tx.busy || free === 0n}>
            {t.withdraw} ({fmtUsd(free, lang)})
          </button>
        </div>
      )}

      {wallet.account && (!l || !isOwner || editable || l.revoked || data.now >= l.expiresAt) && (
        <div className="limits">
          {!data.myLeashes.length && <p className="lead">{t.noLeash}</p>}
          <div className="grid">
            <Field label={t.agentAddress} hint={t.agentAddressHint}>
              <input className="mono" value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" />
            </Field>
            <Field label={t.instant} hint={t.instantHint}>
              <input inputMode="decimal" value={instant} onChange={(e) => setInstant(e.target.value)} />
            </Field>
            <Field label={t.perInvoice}>
              <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
            <Field label={t.perDay}>
              <input inputMode="decimal" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label={`${t.vetoWindow} (${t.minutes})`}>
              <input inputMode="numeric" value={veto} onChange={(e) => setVeto(e.target.value)} />
            </Field>
            <Field label={`${t.expires} (${t.days})`}>
              <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </div>
          <p className="preview">{preview}</p>
          {editable ? (
            <button className="primary" onClick={save} disabled={tx.busy || !isAddress(agent)}>
              {t.saveLimits}
            </button>
          ) : (
            <button className="primary" onClick={create} disabled={tx.busy || !isAddress(agent)}>
              {t.createLeash}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
