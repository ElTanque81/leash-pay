import { useState } from "react";
import { isAddress, type Address } from "viem";
import { leashVaultAbi, payeeRegistryAbi, explorerAddress } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg, chain } from "../lib/config";
import { fmtDate, short } from "../lib/tx";
import { Field, Section } from "./ui";

export function Vendors() {
  const { t, lang } = useT();
  const { wallet, data, tx } = useApp();
  const l = data.leash;
  const isOwner = Boolean(l && wallet.account?.toLowerCase() === l.owner.toLowerCase() && !l.revoked);
  const mine = data.payees.filter((p) => wallet.account && p.owner.toLowerCase() === wallet.account.toLowerCase());

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [payout, setPayout] = useState("");
  const [identity, setIdentity] = useState("");
  const [newPayout, setNewPayout] = useState("");

  const allow = (id: bigint, on: boolean) =>
    tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "setPayeeAllowed", args: [l!.id, id, on] }, t.done);
  const register = () =>
    tx.send(
      {
        address: cfg.registry!,
        abi: payeeRegistryAbi,
        functionName: "register",
        args: [name, domain, (payout || wallet.account) as Address, "", BigInt(identity || "0")],
      },
      t.done,
    );
  const reg = (functionName: string, args: readonly unknown[]) =>
    tx.send({ address: cfg.registry!, abi: payeeRegistryAbi, functionName, args }, t.done);

  return (
    <Section title={t.vendorsTitle} lead={t.vendorsLead}>
      {data.payees.length === 0 ? (
        <p className="empty">{t.noVendors}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.vendor}</th>
              <th>{t.payout}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.payees.map((p) => {
              const frozen = p.pendingPayout !== "0x0000000000000000000000000000000000000000";
              const link = explorerAddress(p.payout, chain.id);
              return (
                <tr key={p.id.toString()} className={p.allowed ? "allowed" : ""}>
                  <td className="num">{p.id.toString()}</td>
                  <td>
                    <div className="strong">{p.name}</div>
                    <div className="muted">
                      {p.domain}
                      {p.identityId > 0n && ` · ERC-8004 #${p.identityId}`}
                    </div>
                  </td>
                  <td>
                    {link ? (
                      <a className="mono" href={link} target="_blank" rel="noreferrer">
                        {short(p.payout)}
                      </a>
                    ) : (
                      <span className="mono">{short(p.payout)}</span>
                    )}
                    {frozen && <div className="flag warn">{t.frozenUntil(fmtDate(p.changeReadyAt, lang))}</div>}
                    {l && p.payout.toLowerCase() === l.agent.toLowerCase() && <div className="flag bad">{t.payoutIsAgent}</div>}
                    {!p.active && <div className="flag">{t.retired}</div>}
                  </td>
                  <td className="right">
                    {isOwner ? (
                      <button className={p.allowed ? "ghost" : "primary"} onClick={() => allow(p.id, !p.allowed)} disabled={tx.busy}>
                        {p.allowed ? t.disallow : t.allow}
                      </button>
                    ) : (
                      p.allowed && <span className="state on">{t.allowed}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {mine.map((p) => {
        const frozen = p.pendingPayout !== "0x0000000000000000000000000000000000000000";
        return (
          <div key={p.id.toString()} className="panel">
            <h2>
              {t.yourEntry}: {p.name}
            </h2>
            {frozen ? (
              <div className="row-form">
                <p className="flag warn">{t.frozenUntil(fmtDate(p.changeReadyAt, lang))}</p>
                <button onClick={() => reg("confirmPayoutChange", [p.id])} disabled={tx.busy || data.now < p.changeReadyAt}>
                  {t.confirmChange}
                </button>
                <button className="ghost" onClick={() => reg("cancelPayoutChange", [p.id])} disabled={tx.busy}>
                  {t.cancelChange}
                </button>
              </div>
            ) : (
              <div className="row-form">
                <Field label={t.changePayout}>
                  <input className="mono" value={newPayout} onChange={(e) => setNewPayout(e.target.value.trim())} placeholder="0x…" />
                </Field>
                <button onClick={() => reg("requestPayoutChange", [p.id, newPayout])} disabled={tx.busy || !isAddress(newPayout)}>
                  {t.requestChange}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {wallet.account && (
        <details className="panel">
          <summary>{t.registerTitle}</summary>
          <p className="lead">{t.registerLead}</p>
          <div className="grid">
            <Field label={t.vendorName}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Webhost GmbH" />
            </Field>
            <Field label={t.vendorDomain}>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="webhost.example" />
            </Field>
            <Field label={t.payout}>
              <input className="mono" value={payout} onChange={(e) => setPayout(e.target.value.trim())} placeholder={wallet.account} />
            </Field>
            <Field label={t.identityId}>
              <input inputMode="numeric" value={identity} onChange={(e) => setIdentity(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <button className="primary" onClick={register} disabled={tx.busy || !name || (payout !== "" && !isAddress(payout))}>
            {t.register}
          </button>
        </details>
      )}
    </Section>
  );
}
