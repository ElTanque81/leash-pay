import { keccak256, toBytes, type Hex } from "viem";

/**
 * Normalise an invoice number so that "INV-0042", "inv 0042" and "INV0042" are the same invoice.
 * Leading zeros inside digit groups are kept (0042 and 42 stay different) to avoid false matches.
 */
export function normaliseInvoiceNo(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The on-chain invoice reference: keccak256 of the normalised invoice number. */
export function invoiceRef(invoiceNo: string): Hex {
  return keccak256(toBytes(normaliseInvoiceNo(invoiceNo)));
}

/** Fingerprint of the invoice document itself (raw bytes), stored in the audit trail. */
export function docHash(raw: Uint8Array | string): Hex {
  return keccak256(typeof raw === "string" ? toBytes(raw) : raw);
}

/** Domain or name normalisation for matching invoices to registered payees. */
export function normaliseName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(gmbh|ag|ug|ltd|llc|inc|co|kg|e\.?k\.?|sarl|bv|oy|sa)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normaliseDomain(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export interface ExtractedInvoice {
  vendorName: string;
  vendorDomain?: string;
  invoiceNo: string;
  /** Decimal string in the invoice currency, e.g. "29.00" */
  amount: string;
  currency: string;
  dueDate?: string;
  /** Text in the document that tries to instruct an AI or changes payment details. Shown to the user. */
  suspicious: string[];
}
