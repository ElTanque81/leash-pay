import { formatEther } from "viem";
import { account, config, publicClient } from "./config.js";
import { Keeper } from "./keeper.js";
import { startServer } from "./server.js";

const chainId = await publicClient.getChainId();
if (chainId !== config.chain.id) {
  throw new Error(`RPC ${config.rpcUrl} is chain ${chainId}, expected ${config.chain.id} (${config.network}).`);
}
const gas = await publicClient.getBalance({ address: account.address });
console.log(`Leash agent ${account.address} on ${config.chain.name} · leash #${config.leashId} · gas ${formatEther(gas)} tQDAY`);
console.log(config.anthropicKey ? `Invoice reading: ${config.llmModel}` : "Invoice reading: built-in rules (set ANTHROPIC_API_KEY for PDFs and free-form invoices)");

const keeper = new Keeper();
keeper.start();
startServer(keeper);
