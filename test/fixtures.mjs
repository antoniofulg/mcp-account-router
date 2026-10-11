import { createServer } from "node:http";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Server, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadConfigurations } from "../dist/config.js";

export const instructions = "Use fixture.echo for the fixture; no provider-specific pipeline.";
export const tool = {
  name: "fixture.echo",
  description: "Unrelated generic fixture",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    additionalProperties: true,
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
  _meta: { category: "synthetic" },
};
export function result(profile, args = {}) {
  return {
    content: [
      { type: "text", text: JSON.stringify({ profile, args }) },
      { type: "image", data: "AA==", mimeType: "image/png" },
    ],
    structuredContent: { profile, args },
    _meta: { stamp: "preserved" },
  };
}
export function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mcp-router-"))),
    file = join(root, "config.json"),
    state = join(root, "state");
  const write = (servers, extra = {}) => {
    writeFileSync(file, JSON.stringify({ version: 1, stateDir: state, servers, ...extra }), {
      mode: 0o600,
    });
    return file;
  };
  return { root, file, state, write, clean: () => rmSync(root, { recursive: true, force: true }) };
}
export async function upstream(behavior) {
  const calls = [],
    requests = [];
  let mode = behavior;
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: "generic-fixture", version: "1" },
        { capabilities: { tools: {} }, instructions },
      );
      server.setRequestHandler("tools/list", async () => ({ tools: [tool] }));
      server.setRequestHandler("tools/call", async (request) => {
        const call = calls.at(-1);
        if (mode) return mode(call);
        return result(call.profile, request.params.arguments);
      });
      return server;
    },
    { legacy: "stateless" },
  );
  const adapter = toNodeHandler(handler);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      res.writeHead(400).end();
      return;
    }
    requests.push(body.method);
    if (body.method === "tools/call") {
      const call = {
        profile: req.headers["x-profile"] ?? "anonymous",
        authorization: req.headers.authorization,
        name: body.params.name,
        args: body.params.arguments,
      };
      calls.push(call);
      if (mode?.httpStatus) {
        res
          .writeHead(mode.httpStatus, { "content-type": "text/plain", "retry-after": "0" })
          .end(mode.body ?? "quota fixture");
        return;
      }
    }
    await adapter(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    calls,
    requests,
    set: (next) => {
      mode = next;
    },
    close: async () => {
      await handler.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export const profile = (url, name = "a", extras = {}) => ({
  name,
  transport: "http",
  url,
  headers: { "X-Profile": name },
  ...extras,
});
export const policy = (extras = {}) => ({
  readOnly: true,
  cache: true,
  dedupe: true,
  failover: true,
  http429: true,
  quotaPatterns: ["quota exhausted"],
  ...extras,
});
export function config(box, profiles, safeTools = {}, ttl) {
  box.write({
    fixture: { profiles, safeTools, ...(ttl === undefined ? {} : { cacheTtlSeconds: ttl }) },
  });
  return loadConfigurations(box.file, "fixture")[0];
}
export async function httpClient(url, token) {
  const client = new Client(
    { name: "consumer", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 0,
        maxReconnectionDelay: 0,
        reconnectionDelayGrowFactor: 1,
      },
    }),
  );
  return client;
}
export async function cliClient(file) {
  const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli.js"), "connect", "--config", file, "--server", "fixture"],
      env: process.env,
      stderr: "pipe",
    }),
    errors = [];
  transport.stderr.on("data", (data) => errors.push(data.toString()));
  const client = new Client(
    { name: "stdio-consumer", version: "1" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(transport, { timeout: 20000 });
  return { client, transport, errors, close: () => client.close() };
}
export function cli(file, action = "status", server = "fixture", env = process.env) {
  return spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      action,
      "--config",
      file,
      ...(action === "validate" ? [] : ["--server", server]),
    ],
    { encoding: "utf8", env, timeout: 20000 },
  );
}
export async function stop(file) {
  const child = spawn(
    process.execPath,
    ["dist/cli.js", "stop", "--config", file, "--server", "fixture"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  await new Promise((resolve, reject) =>
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("stop failed")))),
  );
  return JSON.parse(output);
}
export function content(response) {
  return response.structuredContent;
}
