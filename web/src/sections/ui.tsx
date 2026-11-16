import type { ReactNode } from "react";
import { useApp } from "../ctx";

export function Section({ title, lead, children, aside }: { title: string; lead?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Notice() {
  const { tx } = useApp();
  const n = tx.notice;
  if (!n) return null;
  return (
    <div className={`notice ${n.kind}`} role={n.kind === "error" ? "alert" : "status"}>
      <span>{n.text}</span>
      {n.link && (
        <a href={n.link} target="_blank" rel="noreferrer">
          Explorer
        </a>
      )}
      {n.kind !== "working" && (
        <button className="x" onClick={() => tx.setNotice(undefined)} aria-label="Close">
          ×
        </button>
      )}
    </div>
  );
}

export function TxLink({ hash, href }: { hash: string; href?: string }) {
  const text = `${hash.slice(0, 10)}…`;
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className="mono" title={hash}>
      {text}
    </span>
  );
}

/** The agent writes "Vendor · INV-1 · due 2026-12-01" on-chain; next to the vendor column, drop the name. */
export function memoText(memo: string, vendor?: string): string {
  return vendor && memo.startsWith(`${vendor} · `) ? memo.slice(vendor.length + 3) : memo;
}
