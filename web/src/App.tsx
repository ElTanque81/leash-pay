import { useEffect, useMemo, useState } from "react";
import type { Lang } from "@leash/shared";
import { Ctx } from "./ctx";
import { dictionaries, initialLang, LangContext, saveLang } from "./i18n";
import { cfg, chain, configured } from "./lib/config";
import { useChainData } from "./lib/data";
import { short, useTx } from "./lib/tx";
import { useWallet } from "./lib/wallet";
import { Tether } from "./sections/Tether";
import { Setup } from "./sections/Setup";
import { LeashPanel } from "./sections/LeashPanel";
import { Vendors } from "./sections/Vendors";
import { Inbox } from "./sections/Inbox";
import { Queue } from "./sections/Queue";
import { History } from "./sections/History";
import { Notice } from "./sections/ui";

type Tab = "setup" | "leash" | "vendors" | "inbox" | "queue" | "history";
const TABS: Tab[] = ["setup", "leash", "vendors", "inbox", "queue", "history"];

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    saveLang(l);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const t = dictionaries[lang];

  const wallet = useWallet();
  const [selected, setSelected] = useState<bigint>();
  const data = useChainData(wallet.account, selected);
  const tx = useTx(wallet.client, lang, data.refresh);
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "setup");
  useEffect(() => {
    if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1) as Tab;
      if (TABS.includes(h)) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const queued = data.payments.filter((p) => p.status === "queued").length;
  const ctx = useMemo(() => ({ wallet, data, tx, selectLeash: setSelected }), [wallet, data, tx]);

  return (
    <LangContext.Provider value={{ lang, t, setLang }}>
      <Ctx.Provider value={ctx}>
        <div className="shell">
          <header className="top">
            <div className="brand">
              <img src="/leash.svg" alt="" width={28} height={28} />
              <span className="wordmark">Leash</span>
            </div>
            <p className="tagline">{t.tagline}</p>
            <div className="top-actions">
              <button className="ghost" onClick={() => setLang(lang === "en" ? "de" : "en")} aria-label="Language">
                {t.lang}
              </button>
              {!wallet.account ? (
                <button className="primary" onClick={wallet.connect} disabled={!wallet.hasWallet}>
                  {t.connect}
                </button>
              ) : !wallet.onRightChain ? (
                <button className="warn" onClick={wallet.switchChain}>
                  {t.switchNetwork}
                </button>
              ) : (
                <span className="acct" title={wallet.account}>
                  {short(wallet.account)}
                </span>
              )}
            </div>
          </header>

          <Tether />

          <div className="body">
            <nav className="rail" aria-label="Sections">
              {TABS.map((k) => (
                <button key={k} className={k === tab ? "tab on" : "tab"} onClick={() => setTab(k)} aria-current={k === tab}>
                  {t.nav[k]}
                  {k === "queue" && queued > 0 && <span className="badge">{queued}</span>}
                </button>
              ))}
              <div className="rail-foot">
                {chain.name}
                {!configured && <div className="err-small">VITE_VAULT_ADDRESS / VITE_REGISTRY_ADDRESS missing</div>}
                {configured && <div className="mono-small">{short(cfg.vault!)}</div>}
              </div>
            </nav>
            <main className="main">
              {tab === "setup" && <Setup go={(x) => setTab(x as Tab)} />}
              {tab === "leash" && <LeashPanel />}
              {tab === "vendors" && <Vendors />}
              {tab === "inbox" && <Inbox />}
              {tab === "queue" && <Queue />}
              {tab === "history" && <History />}
            </main>
          </div>
          <Notice />
        </div>
      </Ctx.Provider>
    </LangContext.Provider>
  );
}
