import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { Profile } from "./config.js";

export class UpstreamFailure extends Error {
  constructor(public readonly status?: number) {
    super(status ? `Upstream HTTP ${status}` : "Upstream transport failed");
  }
}
export class Upstream {
  private connection?: Promise<Client>;
  private client?: Client;
  private closed = false;
  constructor(readonly profile: Profile) {}
  async connect(): Promise<Client> {
    if (this.closed) throw new UpstreamFailure();
    if (!this.connection)
      this.connection = this.open().catch((error) => {
        this.connection = undefined;
        throw error;
      });
    return this.connection;
  }
  private async open(): Promise<Client> {
    const client = new Client(
      { name: "mcp-account-router", version: "0.1.0" },
      {
        capabilities: {},
        versionNegotiation: { mode: this.profile.mode, probe: { maxRetries: 0 } },
      },
    );
    this.client = client;
    client.onclose = () => {
      this.connection = undefined;
    };
    client.onerror = () => {}; // Raw provider diagnostics may contain credentials.
    const transport =
      this.profile.transport === "http"
        ? new StreamableHTTPClientTransport(new URL(this.profile.url!), {
            requestInit: { headers: this.profile.headers, redirect: "error" },
            onInsufficientScope: "throw",
            maxStepUpRetries: 0,
            reconnectionOptions: {
              maxRetries: 0,
              initialReconnectionDelay: 0,
              maxReconnectionDelay: 0,
              reconnectionDelayGrowFactor: 1,
            },
            fetch: async (input, init) => {
              let response: Response;
              try {
                response = await fetch(input, { ...init, redirect: "error" });
              } catch {
                throw new UpstreamFailure();
              }
              // Fail before SDK auth/retry handling can amplify an actual provider attempt.
              if (!response.ok) throw new UpstreamFailure(response.status);
              return response;
            },
          })
        : new StdioClientTransport({
            command: this.profile.command!,
            args: this.profile.args,
            env: { ...getDefaultEnvironment(), ...this.profile.env },
            stderr: "pipe",
          });
    if (transport instanceof StdioClientTransport) transport.stderr?.on("data", () => {});
    try {
      await client.connect(transport, { timeout: 10000 });
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error instanceof UpstreamFailure ? error : new UpstreamFailure();
    }
  }
  async list(params?: Record<string, unknown>): Promise<ListToolsResult> {
    return (await this.connect()).request({ method: "tools/list", params });
  }
  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      return await (
        await this.connect()
      ).request({ method: "tools/call", params: { name, arguments: args } }, { timeout: 30000 });
    } catch (error) {
      throw error instanceof UpstreamFailure ? error : new UpstreamFailure();
    }
  }
  get connected(): boolean {
    return !this.closed && this.client?.getNegotiatedProtocolVersion() !== undefined;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.client?.close();
  }
}
