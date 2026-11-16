import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { invoiceRef } from "@leash/shared";
import { cleanAmount, extractWithRules, scanSuspicious } from "../src/parse.js";
import { matchPayee } from "../src/match.js";
import type { KnownPayee } from "../src/payees.js";

const demo = (f: string) => readFileSync(new URL(`../demo-invoices/${f}`, import.meta.url), "utf8");

const payees: KnownPayee[] = [
  { payeeId: 1n, name: "Webhost GmbH", domain: "webhost.example", payout: "0x0000000000000000000000000000000000000001", payable: true },
  { payeeId: 2n, name: "Pixel Studio", domain: "pixel.example", payout: "0x0000000000000000000000000000000000000002", payable: true },
];

test("reads the demo hosting invoice", () => {
  const inv = extractWithRules(demo("01-webhost.txt"));
  assert.equal(inv.vendorName, "Webhost GmbH");
  assert.equal(inv.vendorDomain, "webhost.example");
  assert.equal(inv.invoiceNo, "WH-2026-1107");
  assert.equal(inv.amount, "0.29");
  assert.equal(inv.currency, "TUSD8");
  assert.equal(inv.dueDate, "2026-11-30");
});

test("a re-sent invoice with different spacing maps to the same on-chain reference", () => {
  const a = extractWithRules(demo("01-webhost.txt"));
  const b = extractWithRules(demo("03-webhost-duplicate.txt"));
  assert.equal(b.invoiceNo, "WH 2026 1107");
  assert.equal(invoiceRef(a.invoiceNo), invoiceRef(b.invoiceNo));
  assert.notEqual(invoiceRef(a.invoiceNo), invoiceRef("WH-2026-1108"));
});

test("flags prompt injection and changed bank details", () => {
  const hits = scanSuspicious(demo("04-prompt-injection.txt"));
  assert.ok(hits.some((h) => /ignore all previous instructions/i.test(h)));
  assert.ok(hits.some((h) => /bank details have changed/i.test(h)));
  assert.deepEqual(scanSuspicious(demo("01-webhost.txt")), []);
});

test("matches vendors by domain, never fuzzily", () => {
  const ok = matchPayee(extractWithRules(demo("02-pixel-studio.txt")), payees);
  assert.ok(ok.ok && ok.payee.payeeId === 2n && ok.by === "domain");
  const lookalike = matchPayee(extractWithRules(demo("05-unknown-vendor.txt")), payees);
  assert.equal(lookalike.ok, false);
});

test("parses amounts in German and English formats", () => {
  assert.equal(cleanAmount("1.234,56"), "1234.56");
  assert.equal(cleanAmount("1,234.56"), "1234.56");
  assert.equal(cleanAmount("29,00"), "29.00");
  assert.equal(cleanAmount("0.290"), "0.290");
  assert.equal(cleanAmount("1.500"), "1500");
  assert.equal(cleanAmount("$ 12"), "12");
});
