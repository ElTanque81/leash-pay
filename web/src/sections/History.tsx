import { formatUnits } from "viem";
import { explorerTx } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { chain } from "../lib/config";
import { fmtDate, fmtUsd } from "../lib/tx";
import { Section, TxLink, memoText } from "./ui";

export function History() {
  const { t, lang } = useT();
  const { data } = useApp();
  const pay = (id: bigint) => data.payments.find((p) => p.id === id);
  const payeeName = (id: bigint | undefined) => data.payees.find((p) => p.id === id)?.name ?? (id ? `#${id}` : "");

  function exportCsv() {
    const rows = [["time", "event", "payment_id", "vendor", "amount_tusd8", "invoice_ref", "memo", "tx"]];
    for (const h of data.history) {
      const p = pay(h.paymentId);
      rows.push([
        h.time ? new Date(h.time * 1000).toISOString() : "",
        h.kind,
        h.paymentId.toString(),
        payeeName(p?.payeeId),
        p ? formatUnits(p.amount, 6) : "",
        p?.invoiceRef ?? "",
        p?.memo ?? "",
        h.tx,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `leash-${data.leash?.id ?? ""}-history.csv`;
    a.click();
  }

  return (
    <Section
      title={t.historyTitle}
      lead={t.historyLead}
      aside={
        data.history.length > 0 && (
          <button className="ghost" onClick={exportCsv}>
            {t.exportCsv}
          </button>
        )
      }
    >
      {data.history.length === 0 ? (
        <p className="empty">{t.emptyHistory}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.col.when}</th>
              <th>{t.col.what}</th>
              <th>{t.col.payee}</th>
              <th className="right">{t.col.amount}</th>
              <th>{t.col.invoice}</th>
              <th>{t.col.tx}</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((h) => {
              const p = pay(h.paymentId);
              return (
                <tr key={`${h.kind}-${h.paymentId}`}>
                  <td className="nowrap">{h.time ? fmtDate(h.time, lang) : ""}</td>
                  <td>
                    <span className={`outcome ${h.kind === "paid" ? "paid" : h.kind === "vetoed" ? "rejected" : "queued"}`}>{t.ev[h.kind]}</span>
                  </td>
                  <td>
                    <div>{payeeName(p?.payeeId)}</div>
                    <div className="muted">{p && memoText(p.memo, payeeName(p.payeeId))}</div>
                  </td>
                  <td className="right num nowrap">{p ? fmtUsd(p.amount, lang) : ""}</td>
                  <td className="mono" title={p?.invoiceRef}>
                    {p?.invoiceRef.slice(0, 10)}…
                  </td>
                  <td>
                    <TxLink hash={h.tx} href={explorerTx(h.tx, chain.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
