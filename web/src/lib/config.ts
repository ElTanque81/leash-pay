import { createPublicClient, http, isAddress, type Address } from "viem";
import { chains, TUSD8, type NetworkName } from "@leash/shared";

const network = (import.meta.env.VITE_NETWORK ?? "aevum") as NetworkName;
export const chain = chains[network] ?? chains.aevum;

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? v : undefined;
}

export const cfg = {
  network,
  vault: addr(import.meta.env.VITE_VAULT_ADDRESS),
  registry: addr(import.meta.env.VITE_REGISTRY_ADDRESS),
  token: addr(import.meta.env.VITE_TOKEN_ADDRESS) ?? TUSD8,
  startBlock: BigInt(import.meta.env.VITE_START_BLOCK ?? "0"),
  agentUrl: (import.meta.env.VITE_AGENT_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  faucet: "https://faucet.qday.info/en",
};

export const configured = Boolean(cfg.vault && cfg.registry);

export const publicClient = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 2, retryDelay: 600 }),
});
