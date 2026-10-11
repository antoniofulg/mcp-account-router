import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { readPrivate } from "./files.js";

export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  throw new Error("Only JSON values are supported");
}
export const hash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export type Profile = {
  name: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args: string[];
  headers: Record<string, string>;
  env: Record<string, string>;
  mode: "legacy" | "auto";
  identity: string;
};
export type Policy = {
  readOnly: true;
  cache: boolean;
  dedupe: boolean;
  failover: boolean;
  http429: boolean;
  quotaPatterns: string[];
};
export type Configuration = {
  path: string;
  name: string;
  stateDir: string;
  fingerprint: string;
  profiles: Profile[];
  safeTools: Record<string, Policy>;
  cacheTtlSeconds: number;
  secrets: string[];
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected configuration object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown configuration field");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Expected nonempty configuration string");
  return value;
}
function flag(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("Expected policy boolean");
  return value;
}

export function loadConfigurations(file: string, selected?: string): Configuration[] {
  const environment = process.env;
  const path = resolve(file),
    content = readPrivate(path);
  if (content === null) throw new Error("Configuration file not found");
  let raw: Record<string, unknown>;
  try {
    raw = object(JSON.parse(content));
  } catch {
    throw new Error("Invalid configuration JSON");
  }
  keys(raw, ["version", "stateDir", "servers"]);
  if (raw.version !== 1) throw new Error("Configuration version must be 1");
  const servers = object(raw.servers);
  if (!Object.keys(servers).length || (selected && !Object.hasOwn(servers, selected)))
    throw new Error("Configured server not found");
  const stateDir =
    raw.stateDir === undefined
      ? join(environment.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "mcp-account-router")
      : resolve(dirname(path), text(raw.stateDir));
  return Object.entries(servers)
    .filter(([name]) => !selected || name === selected)
    .map(([name, input]) => {
      text(name);
      const server = object(input);
      keys(server, ["profiles", "safeTools", "cacheTtlSeconds"]);
      const ttl = server.cacheTtlSeconds ?? 604800;
      if (!Number.isSafeInteger(ttl) || (ttl as number) < 0 || (ttl as number) > 31536000)
        throw new Error("Invalid cache TTL");
      const secrets = new Set<string>();
      const binding = (value: unknown): string => {
        if (typeof value === "string") return value; // Literal bindings are public; credentials use env references.
        const ref = object(value);
        keys(ref, ["env", "prefix"]);
        const key = text(ref.env),
          resolved = environment[key];
        if (resolved === undefined || resolved === "")
          throw new Error("Missing credential environment reference");
        if (ref.prefix !== undefined && typeof ref.prefix !== "string")
          throw new Error("Invalid credential prefix");
        secrets.add(resolved);
        const bound = (ref.prefix ?? "") + resolved;
        secrets.add(bound);
        return bound;
      };
      if (!Array.isArray(server.profiles) || !server.profiles.length)
        throw new Error("At least one profile is required");
      const names = new Set<string>();
      const profiles = server.profiles.map((input) => {
        const profile = object(input);
        keys(profile, ["name", "transport", "url", "command", "args", "headers", "env", "mode"]);
        const profileName = text(profile.name);
        if (names.has(profileName)) throw new Error("Duplicate profile name");
        names.add(profileName);
        const mode = profile.mode ?? "legacy";
        if (mode !== "legacy" && mode !== "auto") throw new Error("Unsupported protocol mode");
        const transport = profile.transport;
        if (transport !== "http" && transport !== "stdio")
          throw new Error("Unsupported upstream transport");
        const headers: Record<string, string> = Object.create(null),
          env: Record<string, string> = Object.create(null);
        for (const [key, value] of Object.entries(object(profile.headers ?? {}))) {
          if (
            ["authorization", "proxy-authorization", "cookie", "x-api-key"].includes(
              key.toLowerCase(),
            ) &&
            typeof value === "string"
          )
            throw new Error("Credential headers require environment references");
          headers[key] = binding(value);
        }
        for (const [key, value] of Object.entries(object(profile.env ?? {}))) {
          if (!key || key.includes("=") || key.includes("\0"))
            throw new Error("Invalid environment variable name");
          env[key] = binding(value);
        }
        const args = profile.args ?? [];
        if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
          throw new Error("Invalid stdio arguments");
        let url: string | undefined, command: string | undefined;
        if (transport === "http") {
          url = text(profile.url);
          const parsed = new URL(url);
          if (
            !["http:", "https:"].includes(parsed.protocol) ||
            parsed.username ||
            parsed.password ||
            parsed.hash ||
            profile.command !== undefined ||
            profile.args !== undefined ||
            profile.env !== undefined
          )
            throw new Error("Invalid HTTP profile");
          try {
            new Headers(headers);
          } catch {
            throw new Error("Invalid HTTP headers");
          }
        } else {
          command = text(profile.command);
          if (profile.url !== undefined || profile.headers !== undefined)
            throw new Error("Invalid stdio profile");
        }
        const value = {
          name: profileName,
          transport,
          ...(url ? { url } : {}),
          ...(command ? { command } : {}),
          args,
          headers,
          env,
          mode,
        };
        return { ...value, identity: hash([name, value]) } as Profile;
      });
      const safeTools: Record<string, Policy> = Object.create(null);
      for (const [tool, input] of Object.entries(object(server.safeTools ?? {}))) {
        text(tool);
        const policy = object(input);
        keys(policy, ["readOnly", "cache", "dedupe", "failover", "http429", "quotaPatterns"]);
        if (policy.readOnly !== true) throw new Error("Safe tools require explicit readOnly true");
        const patterns = policy.quotaPatterns ?? [];
        if (
          !Array.isArray(patterns) ||
          patterns.some((value) => typeof value !== "string" || !value)
        )
          throw new Error("Quota patterns must be nonempty literal strings");
        safeTools[tool] = {
          readOnly: true,
          cache: flag(policy.cache),
          dedupe: flag(policy.dedupe),
          failover: flag(policy.failover),
          http429: flag(policy.http429),
          quotaPatterns: patterns,
        };
      }
      const fingerprint = hash({ name, profiles, safeTools, ttl });
      return {
        path,
        name,
        stateDir,
        fingerprint,
        profiles,
        safeTools,
        cacheTtlSeconds: ttl as number,
        secrets: [...secrets],
      };
    });
}
export function redact(message: string, secrets: string[]): string {
  for (const secret of [...secrets].sort((a, b) => b.length - a.length))
    if (secret) message = message.split(secret).join("[redacted]");
  return message.replace(/authorization\s*[:=]\s*[^\r\n]+/gi, "Authorization: [redacted]");
}
