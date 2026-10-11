import { createServer, type Server as HttpServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Server, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { Router } from "./router.js";
import { type Configuration } from "./config.js";

export function toolServer(owner: Pick<Router, "list" | "call">, instructions?: string): Server {
  const server = new Server(
    { name: "mcp-account-router", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions, inputRequired: { legacyShim: false } },
  );
  server.setRequestHandler("tools/list", (request) => owner.list(request.params));
  server.setRequestHandler("tools/call", (request) =>
    owner.call(request.params.name, request.params.arguments ?? {}),
  );
  return server;
}
export type Gateway = {
  url: string;
  token: string;
  server: HttpServer;
  router: Router;
  closed: Promise<void>;
  close: () => Promise<void>;
};
export async function startGateway(config: Configuration): Promise<Gateway> {
  const router = new Router(config);
  let details;
  try {
    details = await router.describe();
  } catch (error) {
    await router.close();
    throw error;
  }
  const token = randomBytes(32).toString("hex");
  const handler: McpHttpHandler = createMcpHandler(
    async () => {
      const current = await router.upstreams[0].connect();
      return toolServer(router, current.getInstructions() ?? details.instructions);
    },
    { legacy: "stateless", onerror: () => {} },
  );
  const nodeHandler = toNodeHandler(handler, { onerror: () => {} });
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await handler.close();
      await router.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      resolveClosed();
    })());
  const server = createServer(async (request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const host = request.headers.host;
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.headers.origin && !origins.includes(request.headers.origin)) {
      response.writeHead(403).end();
      return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401).end();
      return;
    }
    const path = request.url?.split("?")[0];
    if (path === "/_router/status" && request.method === "GET") {
      response
        .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(
          JSON.stringify({ ...router.status(), pid: process.pid, fingerprint: config.fingerprint }),
        );
      return;
    }
    if (path === "/_router/stop" && request.method === "POST") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ stopped: true }));
      setImmediate(() => void close());
      return;
    }
    if (path !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    try {
      await nodeHandler(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end("Gateway failed");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback listener unavailable");
  return { url: `http://127.0.0.1:${address.port}/mcp`, token, server, router, closed, close };
}
