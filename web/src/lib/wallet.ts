import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, numberToHex, type Address, type WalletClient } from "viem";
import { chain, cfg } from "./config";

type Eip1193 = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on?: (ev: string, fn: (...a: unknown[]) => void) => void;
  removeListener?: (ev: string, fn: (...a: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export interface WalletState {
  account?: Address;
  chainId?: number;
  client?: WalletClient;
  hasWallet: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  watchToken: () => Promise<void>;
  onRightChain: boolean;
}

const addChainParams = {
  chainId: numberToHex(chain.id),
  chainName: chain.name,
  rpcUrls: chain.rpcUrls.default.http,
  blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
  nativeCurrency: chain.nativeCurrency,
};

export function useWallet(): WalletState {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();

  useEffect(() => {
    if (!eth) return;
    const onAccounts = (a: unknown) => setAccount((a as Address[])[0]);
    const onChain = (c: unknown) => setChainId(Number(c as string));
    eth.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
    eth.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth]);

  const connect = useCallback(async () => {
    if (!eth) return;
    const a = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
    setAccount(a[0]);
    setChainId(Number(await eth.request({ method: "eth_chainId" })));
  }, [eth]);

  const switchChain = useCallback(async () => {
    if (!eth) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: addChainParams.chainId }] });
    } catch {
      await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams] });
    }
  }, [eth]);

  const watchToken = useCallback(async () => {
    if (!eth) return;
    await eth.request({
      method: "wallet_watchAsset",
      params: { type: "ERC20", options: { address: cfg.token, symbol: "tUSD8", decimals: 6 } },
    });
  }, [eth]);

  const client =
    eth && account ? createWalletClient({ account, chain, transport: custom(eth) }) : undefined;

  return {
    account,
    chainId,
    client,
    hasWallet: Boolean(eth),
    connect,
    switchChain,
    watchToken,
    onRightChain: chainId === chain.id,
  };
}
