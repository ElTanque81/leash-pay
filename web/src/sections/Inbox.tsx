import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg } from "../lib/config";
import { Section, TxLink } from "./ui";

const fmtCurrency = (c: string) => (/^T?USD8$/i.test(c) ? (c.toUpperCase() === "USD8" ? "USD8" : "tUSD8") : c);
const fmtAmount = (a: string, lang: string) => {
  const n = Number(a);
  return a && Number.isFinite(n) ? n.toLocaleString(lang === "de" ? "de-DE" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : a || "?";
};

const demos = import.meta.glob("../../../agent/demo-invoices/*.txt", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const demoList = Object.entries(demos)
  .map(([path, text]) => ({ key: path.split("/").pop()!.replace(".txt", ""), text }))
  .sort((a, b) => a.key.localeCompare(b.key));

interface Decision {
  id: string;
  at: string;
  fileName?: string;
  invoice: {
    vendorName: string;
    vendorDomain?: string;
    invoiceNo: string;
    amount: string;
    currency: string;
    dueDate?: string;
    suspicious: string[];
    via: "llm" | "rules";
  };
  payee?: { payeeId: string; name: string; by: string };
  outcome: "paid" | "queued" | "rejected" | "needs-human";
  reason: { en: string; de: string };
  paymentId?: string;
  txHash?: string;
  explorer?: string;
}

export function Inbox() {
  const { t, lang } = useT();
  const { data } = useApp();
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<{ name: string; b64: string }>();
  const [fileName, setFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState<Decision[]>([]);

  const loadLog = () =>
    fetch(`${cfg.agentUrl}/api/activity`)
      .then((r) => r.json())
      .then(setLog)
      .catch(() => {});
  useEffect(() => {
    loadLog();
  }, []);

  async function onFile(f: File) {
    setFileName(f.name);
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      buf.forEach((b) => (bin += String.fromCharCode(b)));
      setPdf({ name: f.name, b64: btoa(bin) });
      setText("");
    } else {
      setPdf(undefined);
      setText(await f.text());
    }
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${cfg.agentUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pdf ? { pdfBase64: pdf.b64, fileName: pdf.name } : { text, fileName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setLog((l) => [body, ...l.filter((x) => x.id !== body.id)]);
      data.refresh();
    } catch (e) {
      setError(data.agent ? (e as Error).message : t.agentOffline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t.inboxTitle} lead={t.inboxLead}>
      <div className="demo-row" role="group" aria-label={t.demoInvoices}>
        <span className="muted">{t.demoInvoices}:</span>
        {demoList.map((d) => (
          <button
            key={d.key}
            className="chip"
            onClick={() => {
              setText(d.text);
              setPdf(undefined);
              setFileName(`${d.key}.txt`);
            }}
          >
            {t.demo[d.key] ?? d.key}
          </button>
        ))}
      </div>

      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        {pdf ? (
          <div className="pdf-chip">
            PDF: {pdf.name}{" "}
            <button className="ghost" onClick={() => setPdf(undefined)}>
              ×
            </button>
          </div>
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t.pasteHere} rows={11} spellCheck={false} />
        )}
        <div className="row-form">
          <label className="button ghost">
            {t.chooseFile}
            <input type="file" accept=".txt,.pdf,text/plain,application/pdf" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <button className="primary" onClick={send} disabled={busy || (!text.trim() && !pdf)}>
            {busy ? t.sending : t.send}
          </button>
        </div>
        {error && <p className="flag bad">{error}</p>}
      </div>

      <h2>{t.recentDecisions}</h2>
      {log.length === 0 && <p className="empty">{t.noDecisions}</p>}
      <ul className="decisions">
        {log.map((d) => (
          <li key={d.id} className={`decision ${d.outcome}`}>
            <div className="decision-head">
              <span className={`outcome ${d.outcome}`}>{t.outcome[d.outcome]}</span>
              <span className="strong">
                {d.invoice.vendorName || "?"} · {d.invoice.invoiceNo || "?"}
              </span>
              <span className="num">
                {fmtAmount(d.invoice.amount, lang)} {fmtCurrency(d.invoice.currency)}
              </span>
            </div>
            <p className="reason">{d.reason[lang]}</p>
            {d.invoice.suspicious.length > 0 && (
              <div className="suspicious">
                <span>{t.suspicious}:</span>
                <ul>
                  {d.invoice.suspicious.map((s, i) => (
                    <li key={i}>“{s}”</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="decision-meta muted">
              {d.payee && (
                <span>
                  {t.matched} #{d.payee.payeeId} {d.payee.name} ({d.payee.by})
                </span>
              )}
              {d.invoice.dueDate && (
                <span>
                  {t.due} {d.invoice.dueDate}
                </span>
              )}
              <span>{t.via[d.invoice.via]}</span>
              {d.txHash && <TxLink hash={d.txHash} href={d.explorer} />}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
