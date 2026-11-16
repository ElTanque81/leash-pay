import { useCallback, useState } from "react";
import { formatUnits, type Abi, type Address, type Hex, type WalletClient } from "viem";
import { explainError, explorerTx, type Lang } from "@leash/shared";
import { chain, publicClient } from "./config";

export interface TxNotice {
  kind: "working" | "ok" | "error";
  text: string;
  link?: string;
}

/** Simulate, send as a legacy transaction (Aevum), wait for the receipt, explain any revert in plain words. */
export function useTx(client: WalletClient | undefined, lang: Lang, onDone: () => void) {
  const [notice, setNotice] = useState<TxNotice>();
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (req: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }, okText: string) => {
      if (!client?.account) return false;
      setBusy(true);
      setNotice({ kind: "working", text: lang === "de" ? "In der Wallet bestätigen…" : "Confirm in your wallet…" });
      try {
        await publicClient.simulateContract({ ...req, account: client.account } as never);
        const hash: Hex = await client.writeContract({ ...req, account: client.account, chain, type: "legacy" } as never);
        setNotice({ kind: "working", text: lang === "de" ? "Wird auf Aevum bestätigt…" : "Confirming on Aevum…", link: explorerTx(hash, chain.id) });
        const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (r.status !== "success") throw new Error("Transaction reverted");
        setNotice({ kind: "ok", text: okText, link: explorerTx(hash, chain.id) });
        onDone();
        return true;
      } catch (e) {
        setNotice({ kind: "error", text: explainError(e, lang).message });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, lang, onDone],
  );

  return { send, busy, notice, setNotice };
}

export function fmtUsd(v: bigint, lang: Lang, digits = 2): string {
  const n = Number(formatUnits(v, 6));
  return `${n.toLocaleString(lang === "de" ? "de-DE" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: 6 })} tUSD8`;
}

export function fmtDuration(sec: number, lang: Lang): string {
  if (sec <= 0) return lang === "de" ? "0 s" : "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h} h ${m % 60} min`;
  }
  if (m > 0) return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, "0")} min`;
  return `${s} s`;
}

export function fmtDate(unix: number, lang: Lang, withTime = true): string {
  return new Date(unix * 1000).toLocaleString(lang === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
