import { spawn } from "node:child_process";
import { mkdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, type Configuration } from "./config.js";
import { privateDir, readPrivate, writePrivate, noSymlinks } from "./files.js";
import { startGateway } from "./gateway.js";

export type State = { version: 1; url: string; token: string; pid: number; fingerprint: string };
export function paths(config: Configuration) {
  const directory = join(config.stateDir, "daemons", hash([config.path, config.name]));
  privateDir(directory);
  return {
    directory,
    state: join(directory, "connection.json"),
    lock: join(directory, "startup.lock"),
  };
}
export function readState(path: string): State | null {
  const value = readPrivate(path);
  if (!value) return null;
  let state: State;
  try {
    state = JSON.parse(value);
  } catch {
    throw new Error("Invalid daemon state");
  }
  const url = new URL(state.url);
  if (
    state.version !== 1 ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(state.token) ||
    !Number.isSafeInteger(state.pid) ||
    state.pid <= 0 ||
    !/^[a-f0-9]{64}$/.test(state.fingerprint)
  )
    throw new Error("Invalid daemon state");
  return state;
}
export async function control(state: State, action: "status" | "stop") {
  const response = await fetch(new URL(`/_router/${action}`, state.url), {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${state.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error("Daemon control rejected");
  const result = await response.json();
  if (action === "status" && (result.pid !== state.pid || result.fingerprint !== state.fingerprint))
    throw new Error("Daemon identity mismatch");
  return result;
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function discover(config: Configuration): Promise<State> {
  const location = paths(config),
    deadline = Date.now() + 15000;
  while (true) {
    noSymlinks(location.lock);
    try {
      mkdirSync(location.lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() > deadline)
        throw new Error("Daemon startup busy");
      await sleep(30);
    }
  }
  try {
    const existing = readState(location.state);
    if (existing) {
      try {
        await control(existing, "status");
        if (existing.fingerprint !== config.fingerprint)
          throw new Error("Configuration changed; stop and reconnect");
        return existing;
      } catch (error) {
        if (alive(existing.pid)) throw error;
      }
      unlinkSync(location.state);
    }
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./cli.js", import.meta.url)),
        "__daemon",
        "--config",
        config.path,
        "--server",
        config.name,
      ],
      { detached: true, stdio: "ignore", env: process.env },
    );
    child.unref();
    while (Date.now() < deadline) {
      const state = readState(location.state);
      if (state) {
        await control(state, "status");
        return state;
      }
      if (child.pid && !alive(child.pid)) throw new Error("Daemon startup failed");
      await sleep(30);
    }
    throw new Error("Daemon startup timed out");
  } finally {
    rmdirSync(location.lock);
  }
}
export async function runDaemon(config: Configuration): Promise<void> {
  const location = paths(config),
    gateway = await startGateway(config);
  writePrivate(location.state, {
    version: 1,
    url: gateway.url,
    token: gateway.token,
    pid: process.pid,
    fingerprint: config.fingerprint,
  });
  const close = () => {
    void gateway.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  try {
    await gateway.closed;
  } finally {
    const current = readState(location.state);
    if (current?.pid === process.pid) unlinkSync(location.state);
  }
}
