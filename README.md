# MCP account router

A local, tools-only MCP gateway for an operator's independent upstream profiles.
One connection exposes one selected server, retaining its tool names and schemas.
HTTP and stdio upstreams use the official MCP TypeScript SDK 2.3.1. The local stdio
entry accepts protocol 2025 clients, including ordinary legacy MCP clients.

## Install from source

Node 22 or newer is required. Public source publication is separate from npm
registry publication; this project does not claim a registry release.

```sh
git clone https://github.com/antoniofulg/mcp-account-router.git
cd mcp-account-router
npm ci
npm run build
node dist/cli.js validate --config /absolute/path/router.json
```

Copy `examples/router.json` to your own private file and set mode 0600. Its URLs
and environment names are synthetic. Replace them with your server's documented
endpoint and credential environment variables. No existing client configuration
or credential store is migrated. The default private state directory is
`$XDG_STATE_HOME/mcp-account-router`, or `~/.local/state/mcp-account-router`.
`stateDir` optionally selects a path relative to the configuration file.

## Configure a client

Use an absolute built CLI path and choose one server:

```json
{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": [
        "/absolute/path/mcp-account-router/dist/cli.js",
        "connect",
        "--config",
        "/absolute/path/router.json",
        "--server",
        "docs"
      ]
    }
  }
}
```

Credential values are environment references `{ "env": "VARIABLE", "prefix":
"Bearer " }`; optional prefix defaults to empty. Literal bindings are explicitly
public constants. Authorization, Cookie and API-key headers require environment
references. Opaque credential values are not classified by a provider prefix.
Stdio children receive the SDK's safe default environment plus their own bindings,
with no shell. These executables are trusted operator code, not sandboxed.
Use absolute executable/script paths when working directories may differ.

`validate --config FILE` validates all configured servers. `connect` resolves only
the selected server's profiles. `mode` defaults to `legacy`; explicit `auto`
negotiates modern SDK servers (stdio auto negotiation can launch a short-lived
discovery sibling). No OAuth login or credential acquisition is implemented.

## Safe-tool policy

The default `safeTools` map is empty. Every unlisted tool is forwarded once: no
cache, coalescing or profile failover, even with `readOnlyHint: true`.
The operator must review a tool's actual side effects before listing it.
`readOnly: true` is required; `cache`, `dedupe`, `failover` and `http429` each
default to false. `quotaPatterns` are literal, case-sensitive substrings of text
in an `isError` tool result. They are not regular expressions or universal error
classification. HTTP 429 can switch profiles only when both `failover` and
`http429` are enabled. A permitted call tries each ordered profile at most once.
HTTP 401/403, 5xx, network failures and unmatched tool errors never switch profiles.
Upstream discovery/initialization itself does not fail over. SDK transport retries
and OAuth escalation are disabled; provider HTTP failure is raised before SDK
retry handling. Mutations cannot be identified automatically: policy is trusted.

Eligible cache entries use a default 604800-second (seven-day) TTL. Zero disables
cache reads/writes only; separately permitted deduplication/failover still works.
Server, resolved profile/credential identity, tool and canonical arguments isolate
cache and pending work. Failure results are never persisted, and success containing
configured secret values is not cached. Credential rotation changes the identity.
Caching does not detect remote ACL revocation; disable/clear your private cache when
access changes. There is no cache-size eviction or general spending/rate guarantee.

## Lifecycle and status

```sh
node dist/cli.js status --config /absolute/path/router.json --server docs
node dist/cli.js stop --config /absolute/path/router.json --server docs
```

Status reports local call/attempt/cache/coalescing counters and connection state,
not provider quota. It never queries providers. Concurrent connects share one
daemon per configuration/server. Disconnecting one stdio client leaves others
usable. Authenticated stop closes upstream connections/children and the daemon.
After changing configuration or credential environment values, stop the existing
daemon and reconnect. A stale startup lock after an unclean OS kill is a manual
recovery condition; do not delete a live operator's lock or state.

The gateway binds to 127.0.0.1, authenticates a private bearer and checks Host/Origin
before dispatch. Its `/mcp` entry uses SDK stateless HTTP POST; GET/DELETE return 405,
and no legacy SSE subscription is promised. SDK handler errors may be HTTP 200
JSON-RPC errors; factory/connection bootstrap failures can return native HTTP 500.
Tools only are advertised: resources, prompts, OAuth, sampling, elicitation and
tasks are outside this MVP. Advanced callbacks are not transparently proxied.

Private directories/files use 0700/0600. Symlinks in config/state parent paths and
token/cache records are rejected without changing their targets. Use physical
canonical paths (a symlinked `/tmp` alias is also rejected). Filesystem privacy is
supported on POSIX macOS/Linux; full same-OS-user compromise is outside this model.
Configured secrets and authorization details are omitted from diagnostics; child
stderr is deliberately suppressed. Successful tool data itself is forwarded
unchanged and may contain sensitive business content. Same-operator clients share
gateway authority; this is not multi-user tenancy. Remote credentials should use
HTTPS endpoints; HTTP redirects are rejected.

## Verify

```sh
npm run check
npm pack --dry-run
```

Fourteen named owner tests cover transport fidelity/lifecycle, explicit policy,
cache boundaries, actual provider attempt counts, private files, local guards and
public package contents. Tests use synthetic fixtures and do not read private
operator credentials. See `THIRD_PARTY_NOTICES.md` for attribution.

See [ROADMAP.md](ROADMAP.md) for deferred capabilities and their decision boundaries.

Independent readiness evidence: [verification report](https://github.com/antoniofulg/mcp-account-router/blob/main/docs/verification.md).
See [security boundaries](https://github.com/antoniofulg/mcp-account-router/blob/main/docs/security.md) and [deferred decisions](ROADMAP.md).
