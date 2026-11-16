import { normaliseDomain, normaliseName, type ExtractedInvoice } from "@leash/shared";
import type { KnownPayee } from "./payees.js";

export type MatchResult =
  | { ok: true; payee: KnownPayee; by: "domain" | "name" }
  | { ok: false; reason: "no-match" | "ambiguous"; candidates: KnownPayee[] };

/**
 * Map an invoice to exactly one allowed payee: by domain first, then by exact (normalised) name.
 * No fuzzy matching: a look-alike vendor must not slip through. No unique match → a human decides.
 */
export function matchPayee(inv: ExtractedInvoice, payees: KnownPayee[]): MatchResult {
  if (inv.vendorDomain) {
    const d = normaliseDomain(inv.vendorDomain);
    const hits = payees.filter((p) => p.domain && normaliseDomain(p.domain) === d);
    if (hits.length === 1) return { ok: true, payee: hits[0], by: "domain" };
    if (hits.length > 1) return { ok: false, reason: "ambiguous", candidates: hits };
  }
  const n = normaliseName(inv.vendorName);
  const hits = n ? payees.filter((p) => normaliseName(p.name) === n) : [];
  if (hits.length === 1) return { ok: true, payee: hits[0], by: "name" };
  return { ok: false, reason: hits.length > 1 ? "ambiguous" : "no-match", candidates: hits };
}
