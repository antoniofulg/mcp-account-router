import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { appendFileSync } from "node:fs";
import { tool, result, instructions } from "./fixtures.mjs";
if (process.env.FIXTURE_STDERR) process.stderr.write(process.env.FIXTURE_STDERR + "\n");
serveStdio(
  () => {
    const server = new Server(
      { name: "stdio-fixture", version: "1" },
      { capabilities: { tools: {} }, instructions },
    );
    server.setRequestHandler("tools/list", async () => ({ tools: [tool] }));
    server.setRequestHandler("tools/call", async (request) => {
      if (process.env.FIXTURE_LOG)
        appendFileSync(
          process.env.FIXTURE_LOG,
          JSON.stringify({ pid: process.pid, name: request.params.name }) + "\n",
        );
      return {
        ...result(process.env.PROFILE ?? "stdio", request.params.arguments),
        structuredContent: {
          profile: process.env.PROFILE ?? "stdio",
          args: request.params.arguments,
          pid: process.pid,
          other: process.env.UNSELECTED_SECRET ?? null,
        },
      };
    });
    return server;
  },
  { legacy: "serve" },
);
