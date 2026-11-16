import { formatEther } from "viem";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg, chain } from "../lib/config";
import { fmtUsd } from "../lib/tx";
import { Section } from "./ui";

export function Setup({ go }: { go: (tab: string) => void }) {
  const { t, lang } = useT();
  const { wallet, data } = useApp();

  const steps: { key: keyof typeof t.check; ok: boolean; detail?: string; action?: React.ReactNode }[] = [
    {
      key: "wallet",
      ok: Boolean(wallet.account),
      detail: wallet.account ?? t.disconnectedHint,
      action: !wallet.account && (
        <button className="primary" onClick={wallet.connect} disabled={!wallet.hasWallet}>
          {t.connect}
        </button>
      ),
    },
    {
      key: "network",
      ok: wallet.onRightChain,
      detail: `${chain.name} (${chain.id})`,
      action: wallet.account && !wallet.onRightChain && (
        <button className="primary" onClick={wallet.switchChain}>
          {t.addNetwork}
        </button>
      ),
    },
    {
      key: "gas",
      ok: data.gas > 0n,
      detail: wallet.account ? `${Number(formatEther(data.gas)).toFixed(4)} tQDAY` : undefined,
      action: wallet.account && data.gas === 0n && (
        <a className="button" href={cfg.faucet} target="_blank" rel="noreferrer">
          {t.faucet}
        </a>
      ),
    },
    {
      key: "token",
      ok: data.tokenBalance > 0n || (data.leash?.balance ?? 0n) > 0n,
      detail: wallet.account ? fmtUsd(data.tokenBalance, lang) : undefined,
      action: wallet.account && (
        <button className="ghost" onClick={wallet.watchToken}>
          {t.addToken}
        </button>
      ),
    },
    {
      key: "leash",
      ok: data.myLeashes.length > 0,
      detail: data.leash ? t.leashNo(data.leash.id.toString()) : undefined,
      action: data.myLeashes.length === 0 && (
        <button className="primary" onClick={() => go("leash")}>
          {t.createLeash}
        </button>
      ),
    },
    {
      key: "payees",
      ok: data.payees.some((p) => p.allowed),
      detail: data.payees.filter((p) => p.allowed).map((p) => p.name).join(", ") || undefined,
      action: !data.payees.some((p) => p.allowed) && (
        <button className="primary" onClick={() => go("vendors")}>
          {t.nav.vendors}
        </button>
      ),
    },
    {
      key: "agent",
      ok: Boolean(data.agent?.ok),
      detail: data.agent
        ? `${data.agent.agent.slice(0, 10)}… · ${Number(data.agent.agentGas).toFixed(4)} tQDAY · ${data.agent.llm ? "AI" : "rules"}`
        : t.agentOffline,
    },
  ];

  return (
    <Section title={t.setupTitle} lead={t.setupLead}>
      <ol className="checklist">
        {steps.map((s) => (
          <li key={s.key} className={s.ok ? "ok" : "todo"}>
            <span className="mark" aria-hidden="true">
              {s.ok ? "✓" : ""}
            </span>
            <div className="check-text">
              <span className="check-title">{t.check[s.key]}</span>
              {s.detail && <span className="check-detail">{s.detail}</span>}
            </div>
            <div className="check-action">{!s.ok && s.action}</div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
