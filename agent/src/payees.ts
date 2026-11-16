import { getAbiItem } from "viem";
import {
  getLogsChunked,
  leashVaultAbi,
  payeeRegistryAbi,
} from "@leash/shared";
import { config, publicClient } from "./config.js";

export interface KnownPayee {
  payeeId: bigint;
  name: string;
  domain: string;
  payout: `0x${string}`;
  payable: boolean;
}

/** Payees the owner allowed on this leash, with their registry entries. */
export async function loadAllowedPayees(): Promise<KnownPayee[]> {
  const logs = await getLogsChunked(publicClient, {
    address: config.vault,
    event: getAbiItem({ abi: leashVaultAbi, name: "PayeeAllowed" }),
    fromBlock: config.startBlock,
    args: { leashId: config.leashId },
  });
  const ids = [...new Set(logs.map((l) => l.args.payeeId!))];
  const out: KnownPayee[] = [];
  for (const payeeId of ids) {
    const allowed = await publicClient.readContract({
      address: config.vault,
      abi: leashVaultAbi,
      functionName: "payeeAllowed",
      args: [config.leashId, payeeId],
    });
    if (!allowed) continue;
    const p = await publicClient.readContract({
      address: config.registry,
      abi: payeeRegistryAbi,
      functionName: "getPayee",
      args: [payeeId],
    });
    const [, payable] = await publicClient.readContract({
      address: config.registry,
      abi: payeeRegistryAbi,
      functionName: "payoutOf",
      args: [payeeId],
    });
    out.push({ payeeId, name: p.name, domain: p.domain, payout: p.payout, payable });
  }
  return out;
}

export { matchPayee, type MatchResult } from "./match.js";
