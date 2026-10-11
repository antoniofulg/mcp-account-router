# Generic MCP account router

## Problem

Agent clients configured independently cannot share eligible read results or continue across explicitly approved provider quota failures without changing their upstream configuration. Provider-specific wrappers cannot serve unrelated MCP tool schemas. The user reports three existing Context7 accounts and a working private Context7 installation; no measured traffic or latency figures were supplied. This project must neither inspect those credentials nor change that installation.

The user authorized a small generic public CLI and delegated reversible implementation choices. Clients will connect to one local gateway while the operator controls upstream identities and which tools may be cached or retried.

## Flow

The new repository is empty: no existing product owner can be extended. Reuse the official MCP SDK 2 low-level Client/Server and legacy-serving adapters; do not translate tools through a Context7-specific REST API. The user has already authorized this product shape and delegated reversible technical detail; no additional product approval is required before deriving checks.

1. `connect` (new, no door - CLI placement is reversible) validates one selected server and resolves only its profiles, then starts or discovers one authenticated daemon per config/server.
2. The stdio bridge (new, no door) presents legacy-compatible tools MCP to agent clients and forwards to the daemon's loopback HTTP gateway.
3. The gateway (new, no door) verifies bearer/Host/Origin and invokes the selected server's official SDK client over HTTP or stdio. One gateway exposes one server, preserving tool names without aggregation or namespaces.
4. The policy/cache owner (new, no door) authorizes reuse of explicitly named read-only calls. A hit is returned only within the current effective identity. A miss coalesces equivalent eligible reads; configured quota failures may move to the next profile once. Results after failover belong to the actual responding identity.
5. `status` and `stop` (new, no door) use the same authenticated local daemon authority. Status exposes local counters/availability only; stop explicitly terminates the shared daemon and upstream children. Individual client disconnects do not stop other clients.

## Impact

| Front | What changes |
| --- | --- |
| domain | Server: one configured upstream MCP endpoint or stdio launch. Profile: one independently configured upstream identity. Tool policy: explicit operator permission to cache or retry a named read-only tool. |
| stored data | New private configuration and disk cache; no migration of existing private Context7 data. |
| existing clients | New opt-in gateway connection; existing global client configuration remains unchanged. |

## Relations

One Server owns one or more Profiles and zero or more Tool policies. One cache entry belongs to one Server, one effective Profile identity, one tool name and one canonical argument value. Different identities never share entries or pending work.

## Surface

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `HTTP /mcp` | SDK MCP initialize/notifications/tools POST requests; local bearer, Host and optional Origin | Legacy stateless MCP response or notification acceptance; unsupported methods denied; denied requests have no provider work | 200, 202, 400, 401, 403, 405, 500 |

CLI: `mcp-account-router connect --config FILE --server NAME`, `validate --config FILE`, `status --config FILE --server NAME`, and `stop --config FILE --server NAME`. Required flags have no implicit server choice. `validate` exits 0 for valid configuration and 1 for invalid configuration. Status is secret-free local JSON counters/availability, never a universal provider quota API. Stop exits 0 after acknowledged shutdown (including an already stopped daemon) and 1 on a reported failure. Connect writes only protocol traffic to stdout; diagnostics use stderr and never print daemon credentials. Internal control route placement is reversible and must be recorded additively once selected; no public unauthenticated shutdown route.

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Public SDK/runtime contract | Node >=22; TypeScript; `@modelcontextprotocol/client@2.3.1` and `@modelcontextprotocol/server@2.3.1` | Rust gateway: official TypeScript SDK transport evidence and existing Node runtime provide smaller supported route |
| First persisted configuration contract | One selected server per gateway; ordered profiles under that server; explicit named safe-tool allowlist default empty; default cache TTL `604800` seconds; `0` disables caching only | Tool-name aggregation and annotation-derived policy: change exposed names and let provider hints grant retry authority |

Nothing else in this change is hard to reverse. The SDK's official HTTP adapter may be added if required by documented integration, rather than guessing a Node handler API.

## Criteria

### S1: Clients use a generic shared tool gateway (P1)

**Acceptance Criteria**

1. WHEN a client invokes tools against a configured HTTP or stdio upstream THEN the router SHALL serve both transports through the same stable local endpoint without a provider-specific tool pipeline.
2. WHEN an upstream lists or executes a non-Context7 tool THEN the router SHALL preserve tool names, schemas, metadata, and successful result content, including structured and non-text content, plus meaningful server instructions exposed by the SDK.
3. WHEN two clients run `connect` concurrently for the same configuration/server THEN the router SHALL use one shared daemon, preserve request correlation and keep the second client usable after the first disconnects; authenticated `stop` SHALL close upstream clients and child processes.

**Independent test:** Start a mock HTTP upstream and a mock stdio upstream, connect two ordinary SDK clients and invoke unrelated tools through the local gateway.

### S2: Operator-controlled reuse and quota recovery (P1)

**Acceptance Criteria**

4. The router SHALL forward an unlisted tool at most once per client invocation, with zero caching, coalescing or profile failover; only an explicitly named operator-confirmed read-only tool may receive those permissions, regardless of upstream readOnlyHint metadata or hidden SDK retry defaults.
5. WHEN caching is enabled for an eligible tool THEN the router SHALL use a configurable default TTL of 604800 seconds and isolate persisted entries by server, effective profile identity including credential rotation, tool name and canonical arguments; expired or corrupt entries SHALL behave as misses and TTL 0 SHALL disable cache reads/writes only.
6. WHEN simultaneous eligible read calls have the same server, identity, tool and canonical arguments THEN the router SHALL make one upstream invocation and deliver the result to every waiting client; a failed invocation SHALL release pending work for the next call.
7. WHEN an eligible read-only call encounters configured HTTP 429 or configured tool-error quota patterns THEN the router SHALL try each remaining profile at most once in configured order and return the final failure when all eligible profiles fail.
8. IF a tool lacks explicit read-only permission, or an upstream returns HTTP 401, 403, 5xx or a network failure, THEN the router SHALL make exactly one actual upstream attempt and zero automatic retry/profile failover attempts, including for tools advertising readOnlyHint=true and auth errors matching configured quota text.
9. IF an upstream invocation fails at transport level or returns isError=true THEN the router SHALL persist no successful cache entry and return an error instead of a cached substitute.

**Independent test:** Fake upstreams count calls and expose distinct profile markers; advance a controllable clock or expire a real private cache record without waiting seven days.

### S3: Private local operation and safe public delivery (P1)

**Acceptance Criteria**

10. WHEN configuration contains valid server profiles with environment-referenced credentials THEN the router SHALL resolve credentials for the intended profile only; missing references, invalid policy or invalid transport configuration SHALL make `validate`/`connect` fail with exit 1 before any upstream invocation; `status` SHALL expose secret-free local counters/availability only.
11. The router SHALL create private state directories with mode 0700 and files with mode 0600, reject symlinked private state paths, and avoid including credential values in cache keys or records.
12. IF a local gateway request lacks its configured bearer token, has a disallowed Host, or supplies a disallowed Origin THEN the router SHALL reject it before upstream access; the gateway SHALL bind only to loopback addresses.
13. WHEN a credential-bearing configuration, provider error or failed request reaches router diagnostics THEN the router SHALL omit configured secret values, authorization headers and resolved credential environment values from stderr and CLI diagnostic output; stdio protocol output SHALL contain no diagnostic text.
14. WHEN the package and public Git history are prepared for publication THEN the deliverable SHALL contain only synthetic example credentials, no user private files or logs, and required license attribution for any copied upstream code; existing private Context7 installation and global configs SHALL remain unchanged.

**Independent test:** Use synthetic secrets, sandboxed state paths, malicious origin/host requests and a local package/archive scan; never load the user's real credentials.

## Traceability

| ID | Slice | Criteria | Status |
| --- | --- | --- | --- |
| MCP-01 | S1 | 1, 2, 3 | Pending |
| CACHE-01 | S2 | 4, 5, 6, 9 | Pending |
| ROUTE-01 | S2 | 7, 8 | Pending |
| SEC-01 | S3 | 10, 11 | Pending |
| SEC-02 | S3 | 12 | Pending |
| SEC-03 | S3 | 13, 14 | Pending |

## Out of scope

| Excluded | Why |
| --- | --- |
| OAuth login, credential acquisition and provider billing | User authorized a local configurable CLI, not live account changes. |
| Sampling, elicitation, task protocol and arbitrary advanced callback forwarding | A bounded tools gateway avoids false universal compatibility claims. |
| Resources and prompts forwarding | Tool-only MVP explicitly advertises only supported capabilities. |
| Server aggregation and namespaced tool names | One selected upstream per gateway preserves arbitrary upstream tool names. |
| Cloud deployment and npm publication | Public GitHub source is authorized; live deployment and package registry release are separate capabilities. |
| Automatic fallback for mutations or authorization errors | Could duplicate side effects or silently change authority. |
| Semantic detection of arbitrary tool side effects | Explicit safeTools configuration is trusted operator policy requiring manual review; provider annotations cannot establish safety. |
| Browser UI or multi-user remote hosting | Single operator loopback scope. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Reversible technical choices | Official SDK 2 on Node >=22, TypeScript, standard node:test against compiled code | User delegated technical detail; coordinator selected documented SDK route | y |
| Local trust model | Authorized clients sharing the gateway have the same operator-level access | Small local CLI scope; OS-user compromise is outside credential isolation guarantees | n |

**Open questions:** none - remaining local trust default is logged above; no material user decision is required.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| MCP tools | names, schemas, result shapes | AC 1, 2 |
| gateway | authentication, host, origin and bind | AC 12 |
| clients | lifecycle and request correlation | AC 3 |
| tool policy | quota, authorization, retry and cache failures | AC 4, 7, 8, 9 |
| disk cache | TTL, identity and corruption | AC 5, 6, 11 |
| CLI | invalid configuration and secret-safe errors | AC 10, 13 |
| CLI connect/status/stop | stable shared daemon, availability, explicit shutdown, exits | AC 3, 10, 13 |
| public source | examples, package and history | AC 14 |
| browser screens | empty/loading/density/destructive confirmation | n/a - no browser UI |

## Sources

- User authorization relayed by coordinator: generic MCP broker plus public GitHub source; preserve the existing private Context7 installation.
- Coordinator bounded MVP contract: HTTP and stdio upstreams, shared loopback gateway, explicit read-only caching and quota failover, seven-day default, private files and redacted diagnostics.
- Official SDK 2 [legacy clients](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html) and [protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html): transport compatibility selected after explorer evidence; no universal compatibility promise.
- Compatibility target: protocol 2025 clients exercised through the public stdio bridge with HTTP and stdio upstreams; SDK 2 stdio legacy serving and local HTTP legacy stateless POST path, without SSE GET promises.
