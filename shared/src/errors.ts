import { BaseError, ContractFunctionRevertedError, formatUnits } from "viem";

export type Lang = "en" | "de";

type Args = readonly unknown[];
const usd = (v: unknown) => `${formatUnits(BigInt(v as bigint), 6)} tUSD8`;

/** Plain-language messages for every custom error of LeashVault and PayeeRegistry. */
const messages: Record<string, Record<Lang, (a: Args) => string>> = {
  NotOwner: { en: () => "Only the leash owner can do this.", de: () => "Nur der Besitzer des Mandats darf das." },
  NotAgent: { en: () => "This key is not the agent of this leash.", de: () => "Dieser Schlüssel ist nicht der Agent dieses Mandats." },
  UnknownLeash: { en: () => "This leash does not exist.", de: () => "Dieses Mandat gibt es nicht." },
  LeashRevokedErr: { en: () => "Blocked: the leash was revoked (kill switch).", de: () => "Gesperrt: Das Mandat wurde widerrufen (Not-Aus)." },
  LeashExpired: { en: () => "Blocked: the leash has expired.", de: () => "Gesperrt: Das Mandat ist abgelaufen." },
  BadLimits: {
    en: () => "Check the limits: instant ≤ per invoice ≤ per day, an agent address, and an expiry in the future.",
    de: () => "Limits prüfen: Sofort ≤ pro Rechnung ≤ pro Tag, eine Agent-Adresse und ein Ablauf in der Zukunft.",
  },
  ZeroAmount: { en: () => "The amount must be greater than zero.", de: () => "Der Betrag muss größer als null sein." },
  OverInvoiceCap: {
    en: (a) => `Rejected: ${usd(a[0])} is above the per-invoice cap of ${usd(a[1])}. Pay it yourself if it is right.`,
    de: (a) => `Abgelehnt: ${usd(a[0])} liegt über dem Limit pro Rechnung von ${usd(a[1])}. Wenn sie stimmt, zahl sie selbst.`,
  },
  OverDailyCap: {
    en: (a) => `Rejected: ${usd(a[0])} would exceed today's cap. Only ${usd(a[1])} left in this 24 h window.`,
    de: (a) => `Abgelehnt: ${usd(a[0])} würde das Tageslimit sprengen. Noch ${usd(a[1])} frei in diesen 24 h.`,
  },
  InsufficientBalance: {
    en: (a) => `Not enough funds in the leash: needs ${usd(a[0])}, ${usd(a[1])} available.`,
    de: (a) => `Zu wenig Guthaben im Mandat: ${usd(a[0])} nötig, ${usd(a[1])} verfügbar.`,
  },
  PayeeNotAllowed: {
    en: (a) => `Rejected: payee #${a[0]} is not on this leash's allow-list.`,
    de: (a) => `Abgelehnt: Lieferant #${a[0]} ist für dieses Mandat nicht freigegeben.`,
  },
  PayeeNotPayable: {
    en: (a) => `Blocked: payee #${a[0]} just changed its payout address (cooldown running) or is retired.`,
    de: (a) => `Gesperrt: Lieferant #${a[0]} hat gerade seine Auszahlungsadresse geändert (Sperrfrist läuft) oder ist deaktiviert.`,
  },
  PayeeChanged: {
    en: (a) => `Blocked: payee #${a[0]} changed its payout address after this payment was queued. Veto it to free the funds.`,
    de: (a) => `Gesperrt: Lieferant #${a[0]} hat seine Adresse geändert, nachdem die Zahlung eingereiht wurde. Leg ein Veto ein, um das Geld freizugeben.`,
  },
  InvoiceAlreadyUsed: {
    en: (a) => `Rejected: this invoice was already handled (payment #${a[0]}). No double payments.`,
    de: (a) => `Abgelehnt: Diese Rechnung wurde schon bearbeitet (Zahlung #${a[0]}). Keine Doppelzahlung.`,
  },
  NotQueued: { en: () => "This payment is not waiting any more.", de: () => "Diese Zahlung wartet nicht mehr." },
  VetoWindowOpen: {
    en: (a) => `The veto window is still open until ${new Date(Number(a[0]) * 1000).toLocaleTimeString("en-GB")}.`,
    de: (a) => `Das Veto-Fenster ist noch offen bis ${new Date(Number(a[0]) * 1000).toLocaleTimeString("de-DE")}.`,
  },
  WrongPayer: { en: () => "Only the leash owner can sign a gasless deposit.", de: () => "Nur der Besitzer kann eine gaslose Einzahlung unterschreiben." },
  // PayeeRegistry
  ZeroAddress: { en: () => "Address must not be empty.", de: () => "Die Adresse darf nicht leer sein." },
  EmptyName: { en: () => "Please enter a name.", de: () => "Bitte einen Namen eingeben." },
  UnknownPayee: { en: () => "This payee does not exist.", de: () => "Diesen Lieferanten gibt es nicht." },
  NotPayeeOwner: { en: () => "Only the payee's owner can do this.", de: () => "Nur der Inhaber des Lieferanten-Eintrags darf das." },
  NotIdentityOwner: { en: () => "You don't own this ERC-8004 identity.", de: () => "Diese ERC-8004-Identität gehört dir nicht." },
  IdentityLinkDisabled: { en: () => "Identity linking is off on this deployment.", de: () => "Identitäts-Verknüpfung ist hier ausgeschaltet." },
  NoPendingChange: { en: () => "There is no pending address change.", de: () => "Es läuft keine Adressänderung." },
  ChangeNotReady: {
    en: (a) => `The cooldown ends at ${new Date(Number(a[0]) * 1000).toLocaleString("en-GB")}.`,
    de: (a) => `Die Sperrfrist endet am ${new Date(Number(a[0]) * 1000).toLocaleString("de-DE")}.`,
  },
  SamePayout: { en: () => "That is already the payout address.", de: () => "Das ist schon die Auszahlungsadresse." },
};

export interface DecodedError {
  code: string;
  message: string;
}

/** Turn any viem error into a short, plain-language message. */
export function explainError(err: unknown, lang: Lang = "en"): DecodedError {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      const name = revert.data.errorName;
      const m = messages[name];
      if (m) return { code: name, message: m[lang](revert.data.args ?? []) };
      return { code: name, message: name };
    }
    const rejected = err.walk((e) => (e as { code?: number }).code === 4001);
    if (rejected) {
      return { code: "UserRejected", message: lang === "de" ? "In der Wallet abgelehnt." : "Rejected in the wallet." };
    }
    if (/insufficient funds/i.test(err.message)) {
      return {
        code: "NoGas",
        message: lang === "de" ? "Zu wenig tQDAY für Gas." : "Not enough tQDAY for gas.",
      };
    }
    return { code: "Error", message: err.shortMessage };
  }
  return { code: "Error", message: err instanceof Error ? err.message : String(err) };
}
