import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains, type NetworkName } from "@leash/shared";

// Load agent/.env if present (Node 22 built-in; no extra package). Real env vars win.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* no .env file: rely on the environment */
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy agent/.env.example to agent/.env and fill it in.`);
  return v;
}

function address(name: string): Address {
  const v = need(name);
  if (!isAddress(v)) throw new Error(`${name} is not an address: ${v}`);
  return v;
}

const network = (process.env.NETWORK ?? "aevum") as NetworkName;
if (!(network in chains)) throw new Error(`NETWORK must be one of ${Object.keys(chains).join(", ")}`);
const chain = chains[network];
const rpcUrl = process.env.RPC_URL ?? chain.rpcUrls.default.http[0];

const key = need("AGENT_PRIVATE_KEY") as Hex;
export const account = privateKeyToAccount(key.startsWith("0x") ? key : (`0x${key}` as Hex));

export const config = {
  network,
  chain,
  rpcUrl,
  vault: address("VAULT_ADDRESS"),
  registry: address("REGISTRY_ADDRESS"),
  leashId: BigInt(need("LEASH_ID")),
  /** Block to start reading events from (the vault's deploy block keeps log scans short). */
  startBlock: BigInt(process.env.START_BLOCK ?? "0"),
  port: Number(process.env.PORT ?? 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  keeperIntervalMs: Number(process.env.KEEPER_INTERVAL_MS ?? 15000),
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  llmModel: process.env.LLM_MODEL ?? "claude-haiku-5-5",
  /** Stop and ask a human when an invoice contains AI instructions or "new bank details" (default on). */
  stopOnSuspicious: process.env.STOP_ON_SUSPICIOUS !== "false",
  /** Relayer guardrail: largest gasless deposit accepted, in tUSD8 base units. */
  relayMaxAmount: BigInt(process.env.RELAY_MAX_AMOUNT ?? "100000000"),
};

const transport = http(rpcUrl, { retryCount: 3, retryDelay: 750 });
export const publicClient = createPublicClient({ chain, transport });
export const walletClient = createWalletClient({ chain, transport, account });
