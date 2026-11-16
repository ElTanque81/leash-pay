import { useState } from "react";
import { isAddress, zeroAddress, type Address, type Hex } from "viem";
import { ERC8004_IDENTITY_REGISTRY, explainError, explorerAddress, explorerTx, leashVaultAbi, payeeRegistryAbi } from "@leash/shared";
import { useApp } from "../ctx";
import { useT } from "../i18n";
import { leashVaultBytecode, payeeRegistryBytecode } from "../lib/bytecode";
import { cfg, chain, configured, publicClient, saveDeployment, type SavedDeployment } from "../lib/config";
import { Field, Section } from "./ui";

type Step = "idle" | "registry" | "vault" | "done";

/** Deploy PayeeRegistry + LeashVault from the browser, signed by the user's own wallet. No keys leave it. */
export function Deploy() {
  const { t, lang } = useT();
  const { wallet } = useApp();
  const [delay, setDelay] = useState("120");
  const [identity, setIdentity] = useState<string>(chain.id === 44005 ? ERC8004_IDENTITY_REGISTRY : "");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SavedDeployment>();

  const ready = Boolean(wallet.client && wallet.onRightChain);
  const identityOk = identity === "" || isAddress(identity);

  async function deploy() {
    if (!wallet.client?.account) return;
    setError(undefined);
    try {
      const startBlock = await publicClient.getBlockNumber();
      setStep("registry");
      const registryTx: Hex = await wallet.client.deployContract({
        abi: payeeRegistryAbi,
        bytecode: payeeRegistryBytecode,
        args: [BigInt(delay || "0"), (identity || zeroAddress) as Address],
        account: wallet.client.account,
        chain,
        type: "legacy",
      } as never);
      const r1 = await publicClient.waitForTransactionReceipt({ hash: registryTx, timeout: 180_000 });
      if (r1.status !== "success" || !r1.contractAddress) throw new Error("PayeeRegistry deployment failed");

      setStep("vault");
      const vaultTx: Hex = await wallet.client.deployContract({
        abi: leashVaultAbi,
        bytecode: leashVaultBytecode,
        args: [cfg.token, r1.contractAddress],
        account: wallet.client.account,
        chain,
        type: "legacy",
      } as never);
      const r2 = await publicClient.waitForTransactionReceipt({ hash: vaultTx, timeout: 180_000 });
      if (r2.status !== "success" || !r2.contractAddress) throw new Error("LeashVault deployment failed");

      const d: SavedDeployment = {
        registry: r1.contractAddress,
        vault: r2.contractAddress,
        startBlock: startBlock.toString(),
        registryTx,
        vaultTx,
      };
      saveDeployment(d);
      setResult(d);
      setStep("done");
    } catch (e) {
      setError(explainError(e, lang).message);
      setStep("idle");
    }
  }

  const d = result;
  const agentEnv = d
    ? `NETWORK=${cfg.network}\nVAULT_ADDRESS=${d.vault}\nREGISTRY_ADDRESS=${d.registry}\nSTART_BLOCK=${d.startBlock}\nLEASH_ID=1`
    : "";
  const webEnv = d
    ? `VITE_NETWORK=${cfg.network}\nVITE_VAULT_ADDRESS=${d.vault}\nVITE_REGISTRY_ADDRESS=${d.registry}\nVITE_START_BLOCK=${d.startBlock}`
    : "";

  return (
    <Section title={t.deployTitle} lead={t.deployLead}>
      {configured && !d && (
        <div className="panel">
          <h2>{t.deployedAlready}</h2>
          <dl className="figures">
            <div>
              <dt>LeashVault</dt>
              <dd className="mono">{cfg.vault}</dd>
            </div>
            <div>
              <dt>PayeeRegistry</dt>
              <dd className="mono">{cfg.registry}</dd>
            </div>
          </dl>
          {cfg.fromBrowserDeploy && (
            <button
              className="ghost"
              onClick={() => {
                saveDeployment(undefined);
                location.reload();
              }}
            >
              {t.forgetDeployment}
            </button>
          )}
        </div>
      )}

      {!d && (
        <>
          <div className="grid">
            <Field label={t.changeDelay} hint={t.changeDelayHint}>
              <select value={delay} onChange={(e) => setDelay(e.target.value)}>
                <option value="120">{t.delayDemo}</option>
                <option value="172800">{t.delayProd}</option>
              </select>
            </Field>
            <Field label={t.identityRegistry} hint={t.identityRegistryHint}>
              <input className="mono" value={identity} onChange={(e) => setIdentity(e.target.value.trim())} placeholder="0x… (optional)" />
            </Field>
          </div>
          <ol className="steps">
            <li className={step === "registry" ? "now" : step === "vault" || step === "done" ? "ok" : ""}>{t.deployStep1}</li>
            <li className={step === "vault" ? "now" : step === "done" ? "ok" : ""}>{t.deployStep2}</li>
          </ol>
          <button className="primary" onClick={deploy} disabled={!ready || !identityOk || step !== "idle"}>
            {step === "idle" ? t.deployButton : t.working}
          </button>
          {!ready && <p className="muted">{wallet.account ? t.switchNetwork : t.disconnectedHint}</p>}
          {error && <p className="flag bad">{error}</p>}
        </>
      )}

      {d && (
        <div className="panel">
          <h2>
            {t.deployDone} {chain.name}
          </h2>
          <dl className="figures">
            <div>
              <dt>LeashVault</dt>
              <dd className="mono">
                <Link addr={d.vault} />
              </dd>
            </div>
            <div>
              <dt>PayeeRegistry</dt>
              <dd className="mono">
                <Link addr={d.registry} />
              </dd>
            </div>
          </dl>
          <p className="muted">
            {t.deployTxs}: <TxA hash={d.registryTx!} />, <TxA hash={d.vaultTx!} />
          </p>
          <p>{t.deployEnvHint}</p>
          <h3 className="small-head">agent/.env</h3>
          <pre className="code">{agentEnv}</pre>
          <h3 className="small-head">web/.env.local</h3>
          <pre className="code">{webEnv}</pre>
          <button className="primary" onClick={() => {
              location.hash = "leash";
              location.reload();
            }}>
            {t.deployContinue}
          </button>
        </div>
      )}
    </Section>
  );
}

function Link({ addr }: { addr: string }) {
  const href = explorerAddress(addr, chain.id);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {addr}
    </a>
  ) : (
    <>{addr}</>
  );
}

function TxA({ hash }: { hash: string }) {
  const href = explorerTx(hash, chain.id);
  const text = `${hash.slice(0, 10)}…`;
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className="mono">{text}</span>
  );
}
