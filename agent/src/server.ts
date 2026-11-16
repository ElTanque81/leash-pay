import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { formatEther, isAddress, isHex, parseSignature, type Hex } from "viem";
import { explainError, explorerTx, leashVaultAbi } from "@leash/shared";
import { account, config, publicClient, walletClient } from "./config.js";
import { activity, handleInvoice } from "./pay.js";
import type { Keeper } from "./keeper.js";

const MAX_BODY = 8 * 1024 * 1024; // 8 MB: enough for a PDF invoice
const relayCount = new Map<string, { day: string; n: number }>();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    // Lets the hosted app (https://…netlify.app) talk to the agent on localhost (Chrome Private Network Access).
    "access-control-allow-private-network": "true",
  });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request too large");
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function startServer(keeper: Keeper) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const url = new URL(req.url ?? "/", "http://x");

      if (req.method === "GET" && url.pathname === "/api/health") {
        const gas = await publicClient.getBalance({ address: account.address });
        return send(res, 200, {
          ok: true,
          network: config.network,
          chainId: config.chain.id,
          agent: account.address,
          agentGas: formatEther(gas),
          vault: config.vault,
          registry: config.registry,
          leashId: config.leashId,
          llm: Boolean(config.anthropicKey),
          keeper: { lastRun: keeper.lastRun, lastError: keeper.lastError, watching: keeper.queueSize },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/activity") {
        return send(res, 200, activity);
      }

      if (req.method === "POST" && url.pathname === "/api/invoices") {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text : undefined;
        const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : undefined;
        if (!text && !pdfBase64) return send(res, 400, { error: "Send { text } or { pdfBase64 }." });
        const raw = pdfBase64 ? new Uint8Array(Buffer.from(pdfBase64, "base64")) : undefined;
        const decision = await handleInvoice({
          text,
          pdfBase64,
          raw,
          fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 120) : undefined,
        });
        return send(res, 200, decision);
      }

      // Gasless top-up: the owner signs an EIP-3009 authorization, the agent key pays the gas.
      if (req.method === "POST" && url.pathname === "/api/relay/fund") {
        const b = await readJson(req);
        const from = String(b.from ?? "");
        const signature = String(b.signature ?? "");
        if (!isAddress(from) || !isHex(signature) || !isHex(b.nonce)) return send(res, 400, { error: "Bad request" });
        const amount = BigInt(String(b.amount ?? "0"));
        const validAfter = BigInt(String(b.validAfter ?? "0"));
        const validBefore = BigInt(String(b.validBefore ?? "0"));
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (BigInt(String(b.leashId)) !== config.leashId) return send(res, 400, { error: "Only this agent's leash can be relayed." });
        if (amount <= 0n || amount > config.relayMaxAmount) return send(res, 400, { error: "Amount outside relay limit." });
        if (validBefore > now + 3600n) return send(res, 400, { error: "Signature window must be at most 1 hour." });
        const day = new Date().toISOString().slice(0, 10);
        const c = relayCount.get(from.toLowerCase());
        if (c && c.day === day && c.n >= 10) return send(res, 429, { error: "Daily relay limit reached." });

        const { r, s, v, yParity } = parseSignature(signature as Hex);
        const args = [config.leashId, from, amount, validAfter, validBefore, b.nonce as Hex, Number(v ?? BigInt(yParity + 27)), r, s] as const;
        try {
          await publicClient.simulateContract({ address: config.vault, abi: leashVaultAbi, functionName: "fundWithAuthorization", args, account });
        } catch (e) {
          const lang = b.lang === "de" ? "de" : "en";
          return send(res, 400, { error: explainError(e, lang).message });
        }
        const hash = await walletClient.writeContract({
          address: config.vault,
          abi: leashVaultAbi,
          functionName: "fundWithAuthorization",
          args,
          type: "legacy",
        });
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        relayCount.set(from.toLowerCase(), { day, n: (c?.day === day ? c.n : 0) + 1 });
        return send(res, 200, { txHash: hash, explorer: explorerTx(hash, config.chain.id) });
      }

      send(res, 404, { error: "Not found" });
    } catch (e) {
      console.error(e);
      send(res, 500, { error: (e as Error).message });
    }
  });
  server.listen(config.port, () => console.log(`Leash agent API on http://localhost:${config.port}`));
  return server;
}
