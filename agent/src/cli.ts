// Pay one invoice file from the command line:  pnpm --filter @leash/agent pay demo-invoices/01-webhost.txt
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, handleInvoice } from "./pay.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: pnpm pay <invoice.txt|invoice.pdf>");
  process.exit(1);
}
const raw = readFileSync(file);
const isPdf = file.toLowerCase().endsWith(".pdf");
const d = await handleInvoice({
  text: isPdf ? undefined : raw.toString("utf8"),
  pdfBase64: isPdf ? raw.toString("base64") : undefined,
  raw: new Uint8Array(raw),
  fileName: basename(file),
});
console.log(describe(d, process.env.LANG?.startsWith("de") ? "de" : "en"));
if (d.invoice.suspicious.length) console.log("⚠ suspicious text:", d.invoice.suspicious);
if (d.explorer) console.log(d.explorer);
process.exit(d.outcome === "rejected" || d.outcome === "needs-human" ? 2 : 0);
