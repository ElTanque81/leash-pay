import { defineChain, type Address } from "viem";

/** QDay Aevum testnet. HTTPS only (no WebSocket), Shanghai EVM, legacy transactions. */
export const aevum = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

/** Local copy of Aevum made by `make fork` (own chain id so signatures never mix with the real testnet). */
export const aevumFork = defineChain({
  ...aevum,
  id: 440050,
  name: "Aevum Fork (local)",
  rpcUrls: { default: { http: ["http://127.0.0.1:8555"] } },
});

/** Plain local anvil chain (`make anvil`), with MockUSD8 instead of tUSD8. */
export const localAnvil = defineChain({
  ...aevum,
  id: 31337,
  name: "Anvil (local)",
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const chains = { aevum, fork: aevumFork, local: localAnvil } as const;
export type NetworkName = keyof typeof chains;

export const TUSD8: Address = "0x456569838f1d43009A91ebA4263147Afd7233483";
export const TUSD8_DECIMALS = 6;
/** ERC-8004-style identity registry found on Aevum (per the Aevum Starter Kit docs). */
export const ERC8004_IDENTITY_REGISTRY: Address = "0xF45E7f39Caba1d2055f613970575a7e7069636Be";

export function explorerTx(hash: string, chainId: number): string | undefined {
  return chainId === aevum.id ? `${aevum.blockExplorers.default.url}/tx/${hash}` : undefined;
}

export function explorerAddress(addr: string, chainId: number): string | undefined {
  return chainId === aevum.id ? `${aevum.blockExplorers.default.url}/address/${addr}` : undefined;
}
