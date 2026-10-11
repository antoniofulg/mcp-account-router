import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { startGateway } from "../dist/gateway.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { paths, readState } from "../dist/daemon.js";
import { loadConfigurations } from "../dist/config.js";
import {
  sandbox,
  upstream,
  profile,
  config,
  cliClient,
  httpClient,
  cli,
  stop,
  tool,
  result,
  instructions,
  content,
} from "./fixtures.mjs";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function gone(pid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await wait(30);
  }
  throw new Error("Owned process did not stop");
}

test("C01 transports", async () => {
  for (const transport of ["http", "stdio"]) {
    const box = sandbox(),
      provider = transport === "http" ? await upstream() : null;
    const selected =
      transport === "http"
        ? profile(provider.url)
        : {
            name: "stdio",
            transport: "stdio",
            command: process.execPath,
            args: [resolve("test/stdio-fixture.mjs")],
            env: { PROFILE: "stdio" },
          };
    config(box, [selected]);
    let consumer;
    try {
      consumer = await cliClient(box.file);
      assert.equal((await consumer.client.listTools()).tools[0].name, "fixture.echo");
      const value = await consumer.client.callTool({
        name: "fixture.echo",
        arguments: { value: "unrelated" },
      });
      assert.equal(content(value).args.value, "unrelated");
      assert.equal(content(value).profile, transport === "http" ? "a" : "stdio");
    } finally {
      await consumer?.close();
      await stop(box.file);
      await provider?.close();
      box.clean();
    }
  }
});
test("C02 tool fidelity", async () => {
  const box = sandbox(),
    provider = await upstream(),
    gateway = await startGateway(config(box, [profile(provider.url)]));
  let client;
  try {
    client = await httpClient(gateway.url, gateway.token);
    assert.deepEqual((await client.listTools()).tools, [tool]);
    assert.deepEqual(
      await client.callTool({ name: "fixture.echo", arguments: { value: "shape" } }),
      result("a", { value: "shape" }),
    );
    assert.equal(client.getInstructions(), instructions);
    assert.deepEqual(Object.keys(client.getServerCapabilities()), ["tools"]);
  } finally {
    await client?.close();
    await gateway.close();
    await provider.close();
    box.clean();
  }
});
test("C03 shared lifecycle", async () => {
  const box = sandbox();
  config(box, [
    {
      name: "stdio",
      transport: "stdio",
      command: process.execPath,
      args: [resolve("test/stdio-fixture.mjs")],
    },
  ]);
  let a, b, daemon, child;
  try {
    [a, b] = await Promise.all([cliClient(box.file), cliClient(box.file)]);
    const status = cli(box.file);
    assert.equal(status.status, 0);
    daemon = JSON.parse(status.stdout).pid;
    const results = await Promise.all([
      a.client.callTool({ name: "fixture.echo", arguments: { value: "one" } }),
      b.client.callTool({ name: "fixture.echo", arguments: { value: "two" } }),
    ]);
    assert.equal(content(results[0]).args.value, "one");
    assert.equal(content(results[1]).args.value, "two");
    assert.equal(content(results[0]).pid, content(results[1]).pid);
    child = content(results[0]).pid;
    await a.close();
    a = null;
    assert.equal(
      content(await b.client.callTool({ name: "fixture.echo", arguments: { value: "alive" } })).pid,
      child,
    );
    await b.close();
    b = null;
    assert.deepEqual(await stop(box.file), { stopped: true });
    await gone(daemon);
    await gone(child);
    assert.deepEqual(await stop(box.file), { stopped: true });
  } finally {
    await a?.close();
    await b?.close();
    await stop(box.file);
    box.clean();
  }
});
test("C12 local gateway authorization", async () => {
  const box = sandbox(),
    provider = await upstream(),
    gateway = await startGateway(config(box, [profile(provider.url)]));
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "guard-test", version: "1" },
    },
  };
  const headers = {
    Authorization: `Bearer ${gateway.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  try {
    assert.equal(gateway.server.address().address, "127.0.0.1");
    for (const variant of [
      {},
      { Authorization: "Bearer wrong" },
      { ...headers, Host: "evil.example" },
      { ...headers, Origin: "https://evil.example" },
    ]) {
      const code = await new Promise((resolve, reject) => {
        const req = httpRequest(gateway.url, { method: "POST", headers: variant }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("guard response timed out")));
        req.end(JSON.stringify(payload));
      });
      assert.equal(code, variant.Host || variant.Origin ? 403 : 401);
    }
    const malformedStatus = await new Promise((resolve, reject) => {
      const endpoint = new URL(gateway.url);
      const socket = createConnection(Number(endpoint.port), endpoint.hostname);
      socket.once("connect", () =>
        socket.write(
          Buffer.from(
            `POST /mcp HTTP/1.1\r\nHost: ${endpoint.host}\r\nAuthorization: Bearer ${"é".repeat(64)}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
            "latin1",
          ),
        ),
      );
      socket.once("data", (data) => {
        socket.destroy();
        resolve(Number(data.toString("latin1").split(" ")[1]));
      });
      socket.once("error", reject);
      socket.setTimeout(2000, () =>
        socket.destroy(new Error("malformed bearer response timed out")),
      );
    });
    assert.equal(malformedStatus, 401);
    assert.equal(provider.calls.length, 0);
    const client = await httpClient(gateway.url, gateway.token);
    try {
      assert.equal(
        content(await client.callTool({ name: "fixture.echo", arguments: { value: "authorized" } }))
          .profile,
        "a",
      );
    } finally {
      await client.close();
    }
    assert.equal(
      (await fetch(gateway.url, { method: "POST", headers, body: JSON.stringify(payload) })).status,
      200,
    );
    assert.equal(
      (
        await fetch(gateway.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        })
      ).status,
      202,
    );
    assert.equal(
      (await fetch(gateway.url, { method: "POST", headers, body: "broken" })).status,
      400,
    );
    assert.equal((await fetch(gateway.url, { headers })).status, 405);
    assert.equal((await fetch(gateway.url, { method: "DELETE", headers })).status, 405);
    const status = await fetch(new URL("/_router/status", gateway.url), { headers });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).counters.attempts, 1);
    const crash = await fetch(gateway.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "fixture.echo", arguments: { value: "500" } },
      }),
    });
    assert.equal(crash.status, 200);
    // A transport failure is observed through the HTTP gateway, not a fabricated cached result.
    provider.set({ httpStatus: 500 });
    const statuses = [];
    const modern = new Client(
      { name: "modern-status-control", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    await modern.connect(
      new StreamableHTTPClientTransport(new URL(gateway.url), {
        requestInit: { headers },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          statuses.push(response.status);
          return response;
        },
      }),
    );
    try {
      await assert.rejects(modern.callTool({ name: "fixture.echo", arguments: {} }));
      assert.equal(statuses.at(-1), 200);
    } finally {
      await modern.close();
    }
    const stopped = await fetch(new URL("/_router/stop", gateway.url), { method: "POST", headers });
    assert.equal(stopped.status, 200);
    await gateway.closed;
  } finally {
    await gateway.close();
    await provider.close();
    box.clean();
  }
  const childBox = sandbox(),
    launcher = join(childBox.root, "launcher.mjs");
  writeFileSync(
    launcher,
    `import ${JSON.stringify(pathToFileURL(resolve("test/stdio-fixture.mjs")).href)};`,
  );
  const childGateway = await startGateway(
    config(childBox, [
      { name: "stdio", transport: "stdio", command: process.execPath, args: [launcher] },
    ]),
  );
  let childClient;
  try {
    childClient = await httpClient(childGateway.url, childGateway.token);
    const pid = content(await childClient.callTool({ name: "fixture.echo" })).pid;
    unlinkSync(launcher);
    process.kill(pid, "SIGTERM");
    await gone(pid);
    const unavailable = await fetch(childGateway.url, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${childGateway.token}` },
      body: JSON.stringify(payload),
    });
    assert.equal(unavailable.status, 500);
  } finally {
    await childClient?.close();
    await childGateway.close();
    childBox.clean();
  }
});
test("C13 redacted diagnostics", async () => {
  const box = sandbox(),
    secret = "opaque-SYNTHETIC_CREDENTIAL_9284",
    provider = await upstream({ httpStatus: 401, body: `Authorization: ${secret}` });
  let consumer;
  const prior = process.env.FIXTURE_SECRET;
  process.env.FIXTURE_SECRET = secret;
  try {
    box.write({
      fixture: {
        profiles: [
          profile(provider.url, "a", {
            headers: { Authorization: { env: "FIXTURE_SECRET", prefix: "Bearer " } },
          }),
        ],
      },
    });
    consumer = await cliClient(box.file);
    await assert.rejects(consumer.client.callTool({ name: "fixture.echo" }));
    assert.ok(!consumer.errors.join("").includes(secret));
    await consumer.close();
    consumer = null;
    const status = cli(box.file);
    assert.equal(status.status, 0);
    assert.ok(!status.stdout.includes(secret));
    assert.ok(!status.stdout.includes("token"));
    await stop(box.file);
    box.write({
      fixture: {
        profiles: [
          {
            name: "stdio",
            transport: "stdio",
            command: process.execPath,
            args: [resolve("test/stdio-fixture.mjs")],
            env: { FIXTURE_STDERR: { env: "FIXTURE_SECRET" }, PROFILE: "stdio" },
          },
        ],
      },
    });
    consumer = await cliClient(box.file);
    await consumer.client.callTool({ name: "fixture.echo" });
    assert.ok(!consumer.errors.join("").includes(secret));
    await consumer.close();
    consumer = null;
    await stop(box.file);
    writeFileSync(box.file, `{ "version": 99, "secret": "${secret}" }`);
    const bad = cli(box.file, "validate");
    assert.equal(bad.status, 1);
    assert.ok(!bad.stderr.includes(secret));
    assert.equal(bad.stdout, "");
  } finally {
    await consumer?.close();
    await provider.close();
    box.clean();
    if (prior === undefined) delete process.env.FIXTURE_SECRET;
    else process.env.FIXTURE_SECRET = prior;
  }
});
