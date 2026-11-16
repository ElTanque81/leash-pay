import { createContext, useContext } from "react";
import type { ChainData } from "./lib/data";
import type { WalletState } from "./lib/wallet";
import type { useTx } from "./lib/tx";

export interface AppCtx {
  wallet: WalletState;
  data: ChainData;
  tx: ReturnType<typeof useTx>;
  selectLeash: (id: bigint) => void;
}

export const Ctx = createContext<AppCtx>(null as never);
export const useApp = () => useContext(Ctx);
