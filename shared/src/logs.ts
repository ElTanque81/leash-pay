import type { AbiEvent, Address, GetLogsReturnType, PublicClient } from "viem";

/** Aevum's RPC answers eth_getLogs for at most 1,000 blocks per call. */
export const MAX_LOG_RANGE = 1000n;

/** eth_getLogs over any range, in 1,000-block chunks (Aevum limit). */
export async function getLogsChunked<const E extends AbiEvent>(
  client: PublicClient,
  args: { address: Address; event: E; fromBlock: bigint; toBlock?: bigint; args?: Record<string, unknown> },
): Promise<GetLogsReturnType<E>> {
  const to = args.toBlock ?? (await client.getBlockNumber());
  const out: unknown[] = [];
  for (let start = args.fromBlock; start <= to; start += MAX_LOG_RANGE) {
    const end = start + MAX_LOG_RANGE - 1n > to ? to : start + MAX_LOG_RANGE - 1n;
    const logs = await client.getLogs({
      address: args.address,
      event: args.event,
      args: args.args as never,
      fromBlock: start,
      toBlock: end,
    } as never);
    out.push(...(logs as unknown[]));
  }
  return out as GetLogsReturnType<E>;
}
