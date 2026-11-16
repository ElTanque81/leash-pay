import { decodeEventLog, parseUnits, type Hex } from "viem";
import {
  docHash as hashDoc,
  explainError,
  explorerTx,
  invoiceRef as refOf,
  leashVaultAbi,
  TUSD8_DECIMALS,
  type ExtractedInvoice,
  type Lang,
} from "@leash/shared";
import { account, config, publicClient, walletClient } from "./config.js";
import { extractInvoice, type InvoiceInput } from "./extract.js";
import { loadAllowedPayees, matchPayee } from "./payees.js";

const ACCEPTED_CURRENCIES = new Set(["USD", "USD8", "TUSD8", "US$", "$", ""]);

export type Outcome = "paid" | "queued" | "rejected" | "needs-human";

export interface Decision {
  id: string;
  at: string;
  fileName?: string;
  invoice: ExtractedInvoice & { via: "llm" | "rules" };
  payee?: { payeeId: string; name: string; by: "domain" | "name" };
  amount?: string;
  outcome: Outcome;
  code?: string;
  reason: { en: string; de: string };
  paymentId?: string;
  executeAfter?: number;
  txHash?: Hex;
  explorer?: string;
}

const both = (en: string, de: string) => ({ en, de });
const fromError = (e: unknown) => {
  const en = explainError(e, "en");
  return { code: en.code, reason: both(en.message, explainError(e, "de").message) };
};

/** In-memory activity log for the web app (newest first). */
export const activity: Decision[] = [];
let seq = 0;

/** Read an invoice, match it to an allowed payee and propose the payment. The contract decides. */
export async function handleInvoice(input: InvoiceInput & { fileName?: string; raw?: Uint8Array }): Promise<Decision> {
  const invoice = await extractInvoice(input);
  const base = {
    id: String(++seq),
    at: new Date().toISOString(),
    fileName: input.fileName,
    invoice,
  };
  const record = (d: Decision) => {
    activity.unshift(d);
    activity.length = Math.min(activity.length, 200);
    return d;
  };

  if (!invoice.invoiceNo || !invoice.amount) {
    return record({
      ...base,
      outcome: "needs-human",
      code: "Unreadable",
      reason: both(
        "Could not read an invoice number and amount. Please check it yourself.",
        "Rechnungsnummer oder Betrag nicht lesbar. Bitte selbst prüfen.",
      ),
    });
  }
  if (!ACCEPTED_CURRENCIES.has(invoice.currency.toUpperCase())) {
    return record({
      ...base,
      outcome: "needs-human",
      code: "Currency",
      reason: both(
        `The invoice is in ${invoice.currency}. This leash pays in tUSD8 (US dollars) only.`,
        `Die Rechnung ist in ${invoice.currency}. Dieses Mandat zahlt nur in tUSD8 (US-Dollar).`,
      ),
    });
  }

  // Defence in depth: the contract already makes a hijacked agent harmless (it can only pay allowed
  // vendors at their registered address). Still, an invoice that tries to instruct the AI or announces
  // new bank details deserves a human look, so by default the agent stops here.
  if (invoice.suspicious.length && config.stopOnSuspicious) {
    return record({
      ...base,
      amount: invoice.amount,
      outcome: "needs-human",
      code: "Suspicious",
      reason: both(
        "Stopped: the invoice contains instructions for an AI or claims new payment details. Nothing was paid.",
        "Gestoppt: Die Rechnung enthält Anweisungen an eine KI oder behauptet neue Zahlungsdaten. Nichts bezahlt.",
      ),
    });
  }

  let amount: bigint;
  try {
    amount = parseUnits(invoice.amount, TUSD8_DECIMALS);
  } catch {
    return record({ ...base, outcome: "needs-human", code: "Amount", reason: both("Amount not readable.", "Betrag nicht lesbar.") });
  }

  const payees = await loadAllowedPayees();
  const match = matchPayee(invoice, payees);
  if (!match.ok) {
    const list = payees.map((p) => `${p.name} (${p.domain || "–"})`).join(", ") || "–";
    return record({
      ...base,
      amount: invoice.amount,
      outcome: "needs-human",
      code: match.reason === "ambiguous" ? "Ambiguous" : "UnknownVendor",
      reason:
        match.reason === "ambiguous"
          ? both("Several allowed vendors match. Please decide yourself.", "Mehrere freigegebene Lieferanten passen. Bitte selbst entscheiden.")
          : both(
              `"${invoice.vendorName}" (${invoice.vendorDomain ?? "no domain"}) is not an allowed vendor on leash #${config.leashId}. Nothing was paid. Allowed: ${list}.`,
              `„${invoice.vendorName}“ (${invoice.vendorDomain ?? "keine Domain"}) ist kein freigegebener Lieferant von Leine #${config.leashId}. Nichts bezahlt. Freigegeben: ${list}.`,
            ),
    });
  }

  const payee = { payeeId: match.payee.payeeId.toString(), name: match.payee.name, by: match.by };
  const memo = `${match.payee.name} · ${invoice.invoiceNo}${invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}`.slice(0, 120);
  const args = [
    config.leashId,
    match.payee.payeeId,
    amount,
    refOf(invoice.invoiceNo),
    hashDoc(input.raw ?? input.text ?? input.pdfBase64 ?? ""),
    memo,
  ] as const;

  // Dry run first: a rejection costs no gas, and the user sees exactly why.
  try {
    await publicClient.simulateContract({
      address: config.vault,
      abi: leashVaultAbi,
      functionName: "propose",
      args,
      account,
    });
  } catch (e) {
    return record({ ...base, payee, amount: invoice.amount, outcome: "rejected", ...fromError(e) });
  }

  try {
    const hash = await walletClient.writeContract({
      address: config.vault,
      abi: leashVaultAbi,
      functionName: "propose",
      args,
      type: "legacy",
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);

    let paymentId: bigint | undefined;
    let executeAfter = 0;
    let paid = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.vault.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: leashVaultAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "PaymentProposed") {
          paymentId = ev.args.paymentId;
          executeAfter = Number(ev.args.executeAfter);
        }
        if (ev.eventName === "PaymentExecuted") paid = true;
      } catch {
        /* not ours */
      }
    }
    const when = new Date(executeAfter * 1000);
    return record({
      ...base,
      payee,
      amount: invoice.amount,
      outcome: paid ? "paid" : "queued",
      paymentId: paymentId?.toString(),
      executeAfter,
      txHash: hash,
      explorer: explorerTx(hash, config.chain.id),
      reason: paid
        ? both("Paid instantly: small amount to a known vendor.", "Sofort bezahlt: kleiner Betrag an bekannten Lieferanten.")
        : both(
            `Queued. Paid automatically at ${when.toLocaleTimeString("en-GB")} unless you veto.`,
            `Eingereiht. Wird um ${when.toLocaleTimeString("de-DE")} automatisch bezahlt, außer du legst ein Veto ein.`,
          ),
    });
  } catch (e) {
    return record({ ...base, payee, amount: invoice.amount, outcome: "rejected", ...fromError(e) });
  }
}

export function describe(d: Decision, lang: Lang = "en"): string {
  return `[${d.outcome}] ${d.invoice.vendorName} ${d.invoice.invoiceNo} ${d.amount ?? ""} — ${d.reason[lang]}`;
}
