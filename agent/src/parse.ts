import type { ExtractedInvoice } from "@leash/shared";

/** Deterministic parser for plain-text invoices (used without an API key, and for the demo files). */
export function extractWithRules(text: string): ExtractedInvoice {
  const line = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const vendorName =
    line(/^\s*(?:from|vendor|seller|von|lieferant|rechnungssteller)\s*[:\-]\s*(.+)$/im) ||
    text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ||
    "";
  const vendorDomain =
    line(/\b(?:web|website|domain|www)\s*[:\-]\s*(\S+)/i) || line(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/) || undefined;
  const invoiceNo = line(/\b(?:invoice|rechnung)\s*(?:no\.?|number|nr\.?|#|nummer)\s*[:\-]?[ \t]*([A-Za-z0-9][\w\-/ \t]*?)[ \t]*$/im);
  const amountRaw =
    line(/\b(?:total(?:\s+due)?|amount\s+due|gesamt(?:betrag)?|summe|zu\s+zahlen)\s*[:\-]?\s*(?:t?USD8|USD[TC]?|EUR|US\$|\$|€)?\s*([\d.,]+)/i);
  const currency = (line(/\b(tUSD8|USD8|USDT|USDC|USD|EUR)\b/i) || "").toUpperCase();
  const dueRaw = line(/\b(?:due(?:\s+date)?|fällig(?:\s+am)?|zahlbar\s+bis)\s*[:\-]?\s*([\d./-]+)/i);
  return {
    vendorName: vendorName.replace(/\s{2,}/g, " "),
    vendorDomain: vendorDomain || undefined,
    invoiceNo,
    amount: cleanAmount(amountRaw),
    currency,
    dueDate: dueRaw ? toIsoDate(dueRaw) : undefined,
    suspicious: [],
  };
}

const SUSPICIOUS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier)[^.\n]*/i,
  /(?:system|assistant)\s*(?:prompt|message|override)[^.\n]*/i,
  /(?:you are|act as) (?:an? )?(?:ai|assistant|agent)[^.\n]*/i,
  /(?:new|updated|changed) (?:bank|payment|wallet|payout) (?:details|account|address)[^.\n]*/i,
  /(?:bank|payment|wallet|payout) (?:details|account|address)(?:es)? (?:have|has) (?:changed|been (?:updated|changed))[^.\n]*/i,
  /(?:neue|geänderte) (?:bankverbindung|kontoverbindung|wallet[- ]?adresse)[^.\n]*/i,
  /(?:bankverbindung|kontoverbindung|wallet[- ]?adresse) (?:hat sich|wurde) ge(?:ä|ae)ndert[^.\n]*/i,
  /(?:pay|send|transfer|überweise|zahle)[^.\n]{0,40}0x[a-fA-F0-9]{40}[^.\n]*/i,
  /0x[a-fA-F0-9]{40}/,
];

export function scanSuspicious(text: string): string[] {
  const hits: string[] = [];
  for (const re of SUSPICIOUS) {
    const m = text.match(re);
    if (m && !hits.some((h) => h.includes(m[0]))) hits.push(m[0].trim().slice(0, 160));
  }
  return hits;
}

/** "1.234,56" / "1,234.56" / "29,00" / "0.290" → "1234.56" / "1234.56" / "29.00" / "0.290" */
export function cleanAmount(s: string): string {
  const t = s.replace(/[^\d.,]/g, "");
  if (!t) return "";
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    const dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const [int, frac] = [t.slice(0, t.lastIndexOf(dec)), t.slice(t.lastIndexOf(dec) + 1)];
    return `${int.replace(/[.,]/g, "") || "0"}.${frac}`;
  }
  const sep = hasDot ? "." : hasComma ? "," : "";
  if (!sep) return t;
  const parts = t.split(sep);
  // "1.234.567" or "1,234" with a non-zero integer part: a thousands separator.
  if (parts.length > 2 || (parts[1].length === 3 && parts[0] !== "0" && parts[0] !== "")) return parts.join("");
  return `${parts[0] || "0"}.${parts[1]}`;
}

function toIsoDate(s: string): string | undefined {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

