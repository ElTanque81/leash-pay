import { createPublicClient, http, isAddress, type Address } from "viem";
import { chains, LEASH_AEVUM, TUSD8, type NetworkName } from "@leash/shared";

const network = (import.meta.env.VITE_NETWORK ?? "aevum") as NetworkName;
export const chain = chains[network] ?? chains.aevum;

function addr(v: string | undefined | null): Address | undefined {
  return v && isAddress(v) ? v : undefined;
}

export interface SavedDeployment {
  registry: Address;
  vault: Address;
  startBlock: string;
  registryTx?: string;
  vaultTx?: string;
}

const storageKey = `leash.deployment.${chain.id}`;

/** A deployment made from the browser (Deploy page) overrides the build-time addresses on this device. */
export function savedDeployment(): SavedDeployment | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SavedDeployment) : undefined;
  } catch {
    return undefined;
  }
}

export function saveDeployment(d: SavedDeployment | undefined) {
  try {
    if (d) localStorage.setItem(storageKey, JSON.stringify(d));
    else localStorage.removeItem(storageKey);
  } catch {
    /* storage unavailable: addresses still shown for copying */
  }
}

const saved = savedDeployment();
// The public Aevum deployment is the default, so the hosted app works for anyone without setup.
const defaults = network === "aevum" ? LEASH_AEVUM : undefined;

export const cfg = {
  network,
  vault: addr(saved?.vault) ?? addr(import.meta.env.VITE_VAULT_ADDRESS) ?? defaults?.vault,
  registry: addr(saved?.registry) ?? addr(import.meta.env.VITE_REGISTRY_ADDRESS) ?? defaults?.registry,
  token: addr(import.meta.env.VITE_TOKEN_ADDRESS) ?? TUSD8,
  startBlock: BigInt(saved?.startBlock ?? import.meta.env.VITE_START_BLOCK ?? defaults?.startBlock ?? 0n),
  agentUrl: (import.meta.env.VITE_AGENT_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  faucet: "https://faucet.qday.info/en",
  fromBrowserDeploy: Boolean(saved),
};

export const configured = Boolean(cfg.vault && cfg.registry);

export const publicClient = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 2, retryDelay: 600 }),
});
