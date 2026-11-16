import { leashVaultAbi } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { cfg } from "../lib/config";
import { fmtUsd } from "../lib/tx";

/**
 * The leash itself: a rope from you to your agent. It hangs slack while little of today's cap is used
 * and pulls taut as the agent approaches it. Cut it (revoke) and the agent loses every right at once.
 */
export function Tether() {
  const { t, lang } = useT();
  const { data, wallet, tx } = useApp();
  const l = data.leash;
  if (!l) return <div className="tether empty" />;

  const used = l.dailyCap - l.remainingToday;
  const share = l.dailyCap > 0n ? Number((used * 1000n) / l.dailyCap) / 1000 : 0;
  const expired = data.now >= l.expiresAt;
  const cut = l.revoked || expired;
  const sag = cut ? 0 : 46 * (1 - share) + 4;
  const tone = cut ? "cut" : share >= 0.85 ? "taut" : share >= 0.6 ? "tight" : "slack";
  const isOwner = wallet.account?.toLowerCase() === l.owner.toLowerCase();

  const W = 1000;
  const y = 18;
  const path = `M 40 ${y} Q ${W / 2} ${y + sag * 2} ${W - 40} ${y}`;

  async function kill() {
    if (!confirm(t.killConfirm)) return;
    await tx.send({ address: cfg.vault!, abi: leashVaultAbi, functionName: "revoke", args: [l!.id] }, t.revoked);
  }

  return (
    <div className={`tether ${tone}`}>
      <svg viewBox={`0 0 ${W} 120`} preserveAspectRatio="none" aria-hidden="true" className="rope">
        {cut ? (
          <>
            <path d={`M 40 ${y} L ${W / 2 - 26} ${y + 40}`} className="rope-base" />
            <path d={`M ${W / 2 + 26} ${y + 40} L ${W - 40} ${y}`} className="rope-base" />
          </>
        ) : (
          <>
            <path d={path} className="rope-base" />
            <path d={path} className="rope-used" pathLength={100} style={{ strokeDasharray: `${share * 100} 100` }} />
          </>
        )}
        <circle cx={40} cy={y} r={9} className="knot you" />
        <circle cx={W - 40} cy={y} r={9} className="knot agent" />
      </svg>
      <div className="tether-labels">
        <div>
          <strong>{t.leashNo(l.id.toString())}</strong>
          <span className={`state ${cut ? "off" : "on"}`}>{l.revoked ? t.revoked : expired ? t.expired : t.active}</span>
        </div>
        <div className="tether-mid">
          {!cut && (
            <>
              <span className="big num">{fmtUsd(l.remainingToday, lang)}</span> <span>{t.remainingToday}</span>
              <span className="sub num">
                {t.spentToday}: {fmtUsd(used, lang)} / {fmtUsd(l.dailyCap, lang)}
              </span>
            </>
          )}
        </div>
        <div>
          {isOwner && !l.revoked && (
            <button className="danger" onClick={kill} disabled={tx.busy}>
              {t.killSwitch}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
