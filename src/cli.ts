#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfigurations, redact, hash } from "./config.js";
import { discover, paths, readState, control, runDaemon } from "./daemon.js";
import { toolServer } from "./gateway.js";
import { Upstream } from "./upstream.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["connect", "validate", "status", "stop", "__daemon"].includes(command))
    throw new Error("Use connect, validate, status or stop --config FILE --server NAME");
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (!["--config", "--server"].includes(key) || !value || value.startsWith("--") || options[key])
      throw new Error("Invalid CLI flags");
    options[key] = value;
  }
  if (!options["--config"] || (command !== "validate" && !options["--server"]))
    throw new Error("Required CLI flags missing");
  const configurations = loadConfigurations(
    options["--config"],
    command === "validate" ? undefined : options["--server"],
  );
  if (command === "validate") {
    process.stdout.write(
      JSON.stringify({
        valid: true,
        servers: configurations.map((config) => redact(config.name, config.secrets)),
      }) + "\n",
    );
    return;
  }
  const config = configurations[0];
  if (command === "__daemon") {
    await runDaemon(config);
    return;
  }
  if (command === "status" || command === "stop") {
    const state = readState(paths(config).state);
    let result =
      command === "status"
        ? { running: false, server: redact(config.name, config.secrets) }
        : { stopped: true };
    if (state) result = await control(state, command);
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const state = await discover(config);
  const proxy = new Upstream({
    name: "local",
    transport: "http",
    url: state.url,
    args: [],
    env: {},
    headers: { Authorization: `Bearer ${state.token}` },
    mode: "legacy",
    identity: hash(state.fingerprint),
  });
  const client = await proxy.connect();
  const handle = serveStdio(
    () =>
      toolServer(
        {
          list: (params) => proxy.list(params),
          call: (name, args) => proxy.call(name, args ?? {}),
        },
        client.getInstructions(),
      ),
    { legacy: "serve" },
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await handle.close();
    await proxy.close();
  };
  process.stdin.once("end", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
}
void main().catch(() => {
  process.stderr.write(
    "mcp-account-router: configuration or connection failed; check the private config and selected server.\n",
  );
  process.exitCode = 1;
});
