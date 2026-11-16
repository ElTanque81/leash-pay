import { useEffect, useState } from "react";
import { leashVaultAbi, explorerTx } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg, chain } from "../lib/config";
import { fmtDuration, fmtUsd } from "../lib/tx";
import { Section, TxLink, memoText } from "./ui";

export function Queue() {
  const { t, lang } = useT();
  const { wallet, data, tx } = useApp();
  const l = data.leash;
  const isOwner = Boolean(l && wallet.account?.toLowerCase() === l.owner.toLowerCase());
  const queued = data.payments.filter((p) => p.status === "queued").sort((a, b) => a.executeAfter - b.executeAfter);

  // Local clock between polls, anchored to the chain's time.
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const base = Date.now();
    setOffset(0);
    const id = setInterval(() => setOffset(Math.floor((Date.now() - base) / 1000)), 1000);
    return () => clearInterval(id);
  }, [data.now]);
  const now = data.now + offset;

  const payee = (id: bigint) => data.payees.find((p) => p.id === id);

  return (
    <Section title={t.queueTitle} lead={t.queueLead}>
      {queued.length === 0 ? (
        <p className="empty">{t.emptyQueue}</p>
      ) : (
        <ul className="queue">
          {queued.map((p) => {
            const left = p.executeAfter - now;
            const total = l?.vetoWindow || 1;
            const share = Math.min(1, Math.max(0, 1 - left / total));
            return (
              <li key={p.id.toString()} className={p.payeeChanged ? "blocked" : ""}>
                <div className="q-main">
                  <span className="strong">{payee(p.payeeId)?.name ?? `#${p.payeeId}`}</span>
                  <span className="muted">{memoText(p.memo, payee(p.payeeId)?.name)}</span>
                </div>
                <span className="num q-amount">{fmtUsd(p.amount, lang)}</span>
                <div className="q-clock">
                  <div className="q-bar" style={{ ["--p" as string]: share }} />
                  <span>{p.payeeChanged ? t.blockedPayee : left > 0 ? t.paysIn(fmtDuration(left, lang)) : t.ready}</span>
                </div>
                <div className="q-actions">
                  <TxLink hash={p.proposedTx} href={explorerTx(p.proposedTx, chain.id)} />
                  {isOwner && (
                    <>
                      <button
                        className="danger"
                        disabled={tx.busy}
                        onClick={() => tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "veto", args: [p.id] }, t.ev.vetoed)}
                      >
                        {t.veto}
                      </button>
                      {!p.payeeChanged && (
                        <button
                          disabled={tx.busy}
                          onClick={() => tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "approveNow", args: [p.id] }, t.ev.paid)}
                        >
                          {t.payNow}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
