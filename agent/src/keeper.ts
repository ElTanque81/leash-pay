import { getAbiItem } from "viem";
import { explainError, getLogsChunked, leashVaultAbi } from "@leash/shared";
import { config, publicClient, walletClient } from "./config.js";

/**
 * Executes queued payments once their veto window has passed. Anyone may call `execute`,
 * so this needs no special rights; the agent key just pays the gas.
 * HTTPS polling only: Aevum has no WebSocket RPC.
 */
export class Keeper {
  private nextBlock = config.startBlock;
  private queued = new Set<bigint>();
  private running = false;
  private timer?: NodeJS.Timeout;
  lastRun?: string;
  lastError?: string;

  start() {
    const tick = () => {
      this.run()
        .catch((e) => {
          this.lastError = (e as Error).message;
          console.warn("keeper:", this.lastError);
        })
        .finally(() => (this.timer = setTimeout(tick, config.keeperIntervalMs)));
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const head = await publicClient.getBlockNumber();
      if (head >= this.nextBlock) {
        const logs = await getLogsChunked(publicClient, {
          address: config.vault,
          event: getAbiItem({ abi: leashVaultAbi, name: "PaymentProposed" }),
          fromBlock: this.nextBlock,
          toBlock: head,
          args: { leashId: config.leashId },
        });
        for (const l of logs) if (l.args.executeAfter! > 0n) this.queued.add(l.args.paymentId!);
        this.nextBlock = head + 1n;
      }

      const now = (await publicClient.getBlock()).timestamp;
      for (const id of [...this.queued]) {
        const pending = await publicClient.readContract({
          address: config.vault,
          abi: leashVaultAbi,
          functionName: "isPending",
          args: [id],
        });
        if (!pending) {
          this.queued.delete(id); // paid, vetoed, revoked or expired
          continue;
        }
        const p = await publicClient.readContract({
          address: config.vault,
          abi: leashVaultAbi,
          functionName: "payments",
          args: [id],
        });
        const executeAfter = p[5];
        if (executeAfter > now) continue;
        try {
          await publicClient.simulateContract({
            address: config.vault,
            abi: leashVaultAbi,
            functionName: "execute",
            args: [id],
            account: walletClient.account,
          });
        } catch (e) {
          // e.g. PayeeChanged: leave it for the owner to veto, try again later.
          console.log(`keeper: payment #${id} not executable: ${explainError(e).message}`);
          continue;
        }
        const hash = await walletClient.writeContract({
          address: config.vault,
          abi: leashVaultAbi,
          functionName: "execute",
          args: [id],
          type: "legacy",
        });
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        this.queued.delete(id);
        console.log(`keeper: executed payment #${id} (${hash})`);
      }
      this.lastRun = new Date().toISOString();
      this.lastError = undefined;
    } finally {
      this.running = false;
    }
  }

  get queueSize() {
    return this.queued.size;
  }
}
