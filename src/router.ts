import { join } from "node:path";
import { isCallToolResult, type CallToolResult } from "@modelcontextprotocol/client";
import { hash, redact, type Configuration, type Profile } from "./config.js";
import { privateDir, readPrivate, writePrivate } from "./files.js";
import { Upstream, UpstreamFailure } from "./upstream.js";

export class Router {
  readonly upstreams: Upstream[];
  readonly counters = { calls: 0, attempts: 0, cacheHits: 0, coalesced: 0, failovers: 0 };
  private readonly pending = new Map<string, Promise<CallToolResult>>();
  readonly cacheDir: string;
  constructor(readonly config: Configuration) {
    this.cacheDir = join(config.stateDir, "cache");
    privateDir(this.cacheDir);
    this.upstreams = config.profiles.map((profile) => new Upstream(profile));
  }
  key(profile: Profile, name: string, args: Record<string, unknown>): string {
    return hash([this.config.name, profile.identity, name, args]);
  }
  private cached(key: string): CallToolResult | null {
    const value = readPrivate(join(this.cacheDir, `${key}.json`));
    if (!value) return null;
    try {
      const row = JSON.parse(value);
      return row.version === 1 &&
        row.key === key &&
        Number.isFinite(row.expiresAt) &&
        row.expiresAt > Date.now() &&
        isCallToolResult(row.result) &&
        !row.result.isError
        ? row.result
        : null;
    } catch {
      return null;
    }
  }
  async describe() {
    const client = await this.upstreams[0].connect();
    return { instructions: client.getInstructions(), list: await this.upstreams[0].list() };
  }
  async list(params?: Record<string, unknown>) {
    return this.upstreams[0].list(params);
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    this.counters.calls++;
    const policy = this.config.safeTools[name];
    const invoke = async () => {
      for (let index = 0; index < this.upstreams.length; index++) {
        const upstream = this.upstreams[index],
          key = this.key(upstream.profile, name, args);
        if (policy?.cache && this.config.cacheTtlSeconds > 0) {
          const found = this.cached(key);
          if (found) {
            this.counters.cacheHits++;
            return found;
          }
        }
        try {
          this.counters.attempts++;
          const result = await upstream.call(name, args);
          if (!result.isError) {
            const serialized = JSON.stringify(result);
            if (
              policy?.cache &&
              this.config.cacheTtlSeconds > 0 &&
              !this.config.secrets.some(
                (secret) => secret && serialized.includes(JSON.stringify(secret).slice(1, -1)),
              )
            )
              writePrivate(join(this.cacheDir, `${key}.json`), {
                version: 1,
                key,
                expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000,
                result,
              });
            return result;
          }
          const quota = policy?.quotaPatterns.some((pattern) =>
            result.content.some((block) => block.type === "text" && block.text.includes(pattern)),
          );
          if (!policy?.failover || !quota || index === this.upstreams.length - 1) return result;
        } catch (error) {
          if (
            !(error instanceof UpstreamFailure) ||
            error.status !== 429 ||
            !policy?.failover ||
            !policy.http429 ||
            index === this.upstreams.length - 1
          )
            throw error;
        }
        this.counters.failovers++;
      }
      throw new UpstreamFailure();
    };
    if (!policy?.dedupe) return invoke();
    const key = this.key(this.upstreams[0].profile, name, args);
    const existing = this.pending.get(key);
    if (existing) {
      this.counters.coalesced++;
      return existing;
    }
    const work = invoke().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  status() {
    return {
      server: redact(this.config.name, this.config.secrets),
      counters: { ...this.counters },
      profiles: this.upstreams.map((upstream) => ({
        name: redact(upstream.profile.name, this.config.secrets),
        connected: upstream.connected,
      })),
    };
  }
  async close() {
    await Promise.allSettled(this.upstreams.map((upstream) => upstream.close()));
  }
}
