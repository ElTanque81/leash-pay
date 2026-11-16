import { createContext, useContext } from "react";
import type { Lang } from "@leash/shared";

const en = {
  tagline: "Your AI pays the bills. The chain holds the leash.",
  connect: "Connect wallet",
  switchNetwork: "Switch to Aevum",
  disconnectedHint: "Connect the wallet that owns the money. The agent never gets it.",
  nav: { setup: "Setup", leash: "Leash", vendors: "Vendors", inbox: "Inbox", queue: "Queue", history: "History" },

  // setup
  setupTitle: "Before your agent can pay",
  setupLead: "Leash checks your wallet, network, balances and agent, and tells you what to fix.",
  check: {
    wallet: "Wallet connected",
    network: "Wallet on the right network",
    gas: "tQDAY for gas",
    token: "tUSD8 in your wallet",
    leash: "A leash for your agent",
    payees: "At least one allowed vendor",
    agent: "Agent online",
  },
  addNetwork: "Add Aevum to wallet",
  addToken: "Show tUSD8 in wallet",
  faucet: "Get test tokens",
  agentOffline: "The agent service is not reachable. Start it with pnpm agent.",

  // leash
  leashTitle: "The leash",
  leashLead: "These rules live in the contract. The agent cannot change or bypass them.",
  noLeash: "You have no leash yet. Set the limits below and create one.",
  createLeash: "Create leash",
  saveLimits: "Save limits",
  agentAddress: "Agent address",
  agentAddressHint: "The agent's own key. It needs a little tQDAY and never holds tUSD8.",
  instant: "Pay instantly up to",
  instantHint: "Only to vendors that were paid before.",
  perInvoice: "Largest single invoice",
  perDay: "Most per 24 hours",
  vetoWindow: "Veto window",
  expires: "Leash expires after",
  runsUntil: "Runs until",
  minutes: "min",
  days: "days",
  preview: (a: { instant: string; max: string; day: string; veto: string; days: string }) =>
    `Your agent may pay at most ${a.max} per invoice and ${a.day} per day. Payments up to ${a.instant} to known vendors go out at once; anything else waits ${a.veto} for your veto. The leash ends in ${a.days} days.`,
  balance: "In the leash",
  reserved: "Waiting in queue",
  spentToday: "Used today",
  remainingToday: "left today",
  fund: "Add funds",
  fundGasless: "Add without gas",
  fundGaslessHint: "You sign, the agent pays the gas (EIP-3009).",
  withdraw: "Withdraw",
  amount: "Amount",
  killSwitch: "Revoke leash",
  killConfirm: "Revoke this leash? The agent loses all rights at once and queued payments are cancelled. You can withdraw everything afterwards.",
  revoked: "Revoked",
  expired: "Expired",
  active: "Active",
  leashNo: (n: string) => `Leash #${n}`,
  expiresAt: (d: string) => `Ends ${d}`,

  // vendors
  vendorsTitle: "Vendors",
  vendorsLead: "Vendors register their own payout address. Your agent can only pay vendors you allow here.",
  allowed: "Allowed",
  allow: "Allow",
  disallow: "Remove",
  frozen: "Address change pending",
  frozenUntil: (d: string) => `New address active from ${d}. Payments blocked until then.`,
  retired: "Retired",
  registerTitle: "Are you a vendor? Register",
  registerLead: "Your payout address can only be changed with a cooldown, so nobody can redirect your payments overnight.",
  vendorName: "Company name",
  vendorDomain: "Website or e-mail domain",
  payout: "Payout address",
  identityId: "ERC-8004 identity id (optional)",
  register: "Register",
  yourEntry: "Your entry",
  changePayout: "Change payout address",
  requestChange: "Request change",
  confirmChange: "Confirm change",
  cancelChange: "Cancel change",
  noVendors: "No vendors registered yet.",

  // inbox
  inboxTitle: "Inbox",
  inboxLead: "Hand the agent an invoice. It reads it and asks the contract to pay. The contract decides.",
  pasteHere: "Paste invoice text here, or drop a .txt or .pdf file",
  chooseFile: "Choose file",
  send: "Give to agent",
  sending: "Agent is reading…",
  demoInvoices: "Demo invoices",
  demo: {
    "01-webhost": "Hosting 0.29",
    "02-pixel-studio": "Design 1.50",
    "03-webhost-duplicate": "Same hosting invoice again",
    "04-prompt-injection": "Hidden AI instruction",
    "05-unknown-vendor": "Look-alike vendor",
    "06-too-big": "Over the cap",
  } as Record<string, string>,
  read: "What the agent read",
  vendor: "Vendor",
  invoiceNo: "Invoice",
  due: "Due",
  matched: "Matched to",
  via: { llm: "read by AI model", rules: "read by built-in rules" },
  suspicious: "Suspicious text in this invoice",
  outcome: { paid: "Paid", queued: "Queued", rejected: "Rejected", "needs-human": "Needs you" } as Record<string, string>,
  recentDecisions: "Recent decisions",
  noDecisions: "No invoices yet. Try a demo invoice.",

  // queue
  queueTitle: "Queue",
  queueLead: "Payments wait here until the veto window closes. Then the keeper pays them.",
  emptyQueue: "Nothing waiting.",
  veto: "Veto",
  payNow: "Pay now",
  paysIn: (s: string) => `pays in ${s}`,
  ready: "ready, keeper pays next",
  blockedPayee: "Payee changed its address: veto to release the money.",

  // history
  historyTitle: "History",
  historyLead: "Every decision is an event on Aevum. This is your audit trail.",
  exportCsv: "Export CSV",
  emptyHistory: "No payments yet.",
  col: { when: "When", what: "What", payee: "Vendor", amount: "Amount", invoice: "Invoice ref", tx: "Transaction" },
  ev: { proposed: "Proposed", paid: "Paid", vetoed: "Vetoed" },

  // generic
  working: "Waiting for wallet…",
  done: "Done",
  copy: "Copy",
  explorer: "Explorer",
  confirmInWallet: "Confirm in your wallet",
  lang: "Deutsch",
};

type Dict = typeof en;

const de: Dict = {
  tagline: "Deine KI bezahlt die Rechnungen. Die Blockchain hält die Leine.",
  connect: "Wallet verbinden",
  switchNetwork: "Zu Aevum wechseln",
  disconnectedHint: "Verbinde die Wallet, der das Geld gehört. Der Agent bekommt es nie.",
  nav: { setup: "Start", leash: "Leine", vendors: "Lieferanten", inbox: "Posteingang", queue: "Warteschlange", history: "Verlauf" },

  setupTitle: "Bevor dein Agent zahlen kann",
  setupLead: "Leash prüft Wallet, Netzwerk, Guthaben und Agent und sagt dir, was fehlt.",
  check: {
    wallet: "Wallet verbunden",
    network: "Wallet im richtigen Netzwerk",
    gas: "tQDAY für Gas",
    token: "tUSD8 in deiner Wallet",
    leash: "Eine Leine für deinen Agenten",
    payees: "Mindestens ein freigegebener Lieferant",
    agent: "Agent online",
  },
  addNetwork: "Aevum zur Wallet hinzufügen",
  addToken: "tUSD8 in der Wallet anzeigen",
  faucet: "Testtoken holen",
  agentOffline: "Der Agent-Dienst ist nicht erreichbar. Starte ihn mit pnpm agent.",

  leashTitle: "Die Leine",
  leashLead: "Diese Regeln stehen im Contract. Der Agent kann sie weder ändern noch umgehen.",
  noLeash: "Du hast noch keine Leine. Lege unten die Limits fest und erstelle eine.",
  createLeash: "Leine erstellen",
  saveLimits: "Limits speichern",
  agentAddress: "Agent-Adresse",
  agentAddressHint: "Der eigene Schlüssel des Agenten. Er braucht etwas tQDAY und hält nie tUSD8.",
  instant: "Sofort zahlen bis",
  instantHint: "Nur an Lieferanten, die schon einmal bezahlt wurden.",
  perInvoice: "Größte einzelne Rechnung",
  perDay: "Höchstens pro 24 Stunden",
  vetoWindow: "Veto-Fenster",
  expires: "Leine läuft ab nach",
  runsUntil: "Läuft bis",
  minutes: "Min.",
  days: "Tagen",
  preview: (a) =>
    `Dein Agent darf höchstens ${a.max} pro Rechnung und ${a.day} pro Tag zahlen. Beträge bis ${a.instant} an bekannte Lieferanten gehen sofort raus, alles andere wartet ${a.veto} auf dein Veto. Die Leine endet in ${a.days} Tagen.`,
  balance: "In der Leine",
  reserved: "Wartet in der Schlange",
  spentToday: "Heute verbraucht",
  remainingToday: "heute noch frei",
  fund: "Aufladen",
  fundGasless: "Ohne Gas aufladen",
  fundGaslessHint: "Du unterschreibst, der Agent zahlt das Gas (EIP-3009).",
  withdraw: "Abheben",
  amount: "Betrag",
  killSwitch: "Leine kappen",
  killConfirm: "Leine kappen? Der Agent verliert sofort alle Rechte und wartende Zahlungen werden storniert. Danach kannst du alles abheben.",
  revoked: "Gekappt",
  expired: "Abgelaufen",
  active: "Aktiv",
  leashNo: (n) => `Leine #${n}`,
  expiresAt: (d) => `Endet ${d}`,

  vendorsTitle: "Lieferanten",
  vendorsLead: "Lieferanten tragen ihre Auszahlungsadresse selbst ein. Dein Agent kann nur Lieferanten bezahlen, die du hier freigibst.",
  allowed: "Freigegeben",
  allow: "Freigeben",
  disallow: "Entfernen",
  frozen: "Adressänderung läuft",
  frozenUntil: (d) => `Neue Adresse aktiv ab ${d}. Bis dahin sind Zahlungen gesperrt.`,
  retired: "Deaktiviert",
  registerTitle: "Du bist Lieferant? Hier registrieren",
  registerLead: "Deine Auszahlungsadresse lässt sich nur mit Sperrfrist ändern. So kann niemand deine Zahlungen über Nacht umleiten.",
  vendorName: "Firmenname",
  vendorDomain: "Website oder E-Mail-Domain",
  payout: "Auszahlungsadresse",
  identityId: "ERC-8004-Identitäts-ID (optional)",
  register: "Registrieren",
  yourEntry: "Dein Eintrag",
  changePayout: "Auszahlungsadresse ändern",
  requestChange: "Änderung beantragen",
  confirmChange: "Änderung bestätigen",
  cancelChange: "Änderung abbrechen",
  noVendors: "Noch keine Lieferanten registriert.",

  inboxTitle: "Posteingang",
  inboxLead: "Gib dem Agenten eine Rechnung. Er liest sie und bittet den Contract um Zahlung. Der Contract entscheidet.",
  pasteHere: "Rechnungstext hier einfügen oder eine .txt- oder .pdf-Datei hineinziehen",
  chooseFile: "Datei wählen",
  send: "An Agent geben",
  sending: "Agent liest…",
  demoInvoices: "Demo-Rechnungen",
  demo: {
    "01-webhost": "Hosting 0,29",
    "02-pixel-studio": "Design 1,50",
    "03-webhost-duplicate": "Gleiche Hosting-Rechnung nochmal",
    "04-prompt-injection": "Versteckter KI-Befehl",
    "05-unknown-vendor": "Gefälschter Lieferant",
    "06-too-big": "Über dem Limit",
  },
  read: "Was der Agent gelesen hat",
  vendor: "Lieferant",
  invoiceNo: "Rechnung",
  due: "Fällig",
  matched: "Zugeordnet zu",
  via: { llm: "gelesen vom KI-Modell", rules: "gelesen mit festen Regeln" },
  suspicious: "Verdächtiger Text in dieser Rechnung",
  outcome: { paid: "Bezahlt", queued: "Eingereiht", rejected: "Abgelehnt", "needs-human": "Braucht dich" },
  recentDecisions: "Letzte Entscheidungen",
  noDecisions: "Noch keine Rechnungen. Probier eine Demo-Rechnung.",

  queueTitle: "Warteschlange",
  queueLead: "Zahlungen warten hier, bis das Veto-Fenster schließt. Dann zahlt der Keeper.",
  emptyQueue: "Nichts wartet.",
  veto: "Veto",
  payNow: "Jetzt zahlen",
  paysIn: (s) => `zahlt in ${s}`,
  ready: "bereit, Keeper zahlt gleich",
  blockedPayee: "Lieferant hat seine Adresse geändert: Veto einlegen, um das Geld freizugeben.",

  historyTitle: "Verlauf",
  historyLead: "Jede Entscheidung ist ein Event auf Aevum. Das ist dein Prüfpfad.",
  exportCsv: "CSV exportieren",
  emptyHistory: "Noch keine Zahlungen.",
  col: { when: "Wann", what: "Was", payee: "Lieferant", amount: "Betrag", invoice: "Rechnungs-Ref.", tx: "Transaktion" },
  ev: { proposed: "Vorgeschlagen", paid: "Bezahlt", vetoed: "Veto" },

  working: "Warte auf Wallet…",
  done: "Erledigt",
  copy: "Kopieren",
  explorer: "Explorer",
  confirmInWallet: "In der Wallet bestätigen",
  lang: "English",
};

export const dictionaries: Record<Lang, Dict> = { en, de };

export const LangContext = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void }>({
  lang: "en",
  t: en,
  setLang: () => {},
});

export const useT = () => useContext(LangContext);

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("leash.lang");
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
}

export function saveLang(l: Lang) {
  try {
    localStorage.setItem("leash.lang", l);
  } catch {
    /* ignore */
  }
}
