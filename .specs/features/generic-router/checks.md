# Generic MCP account router checks

Profile: standard
Plan: `.specs/features/generic-router/plan.md`

14 checks in 3 slices · 2 one-way doors · 0 open blocking questions. User already approved generic CLI/public source and delegated technical choices; coordinator selected the official SDK/Node route. Checks derive from that scope and freeze before product code.

Runner contract: newly authorized project uses TypeScript compiled by `npm run build` (`tsc`), then Node's built-in test runner against plain `.mjs` tests importing compiled production code. Planned manifest entry `test` is `npm run build && node --test --test-concurrency=1 test/*.test.mjs`. Each Proof below runs after `npm run build`; named tests are exact owner contracts to create, not invented custom runner flags. `typecheck` is `tsc --noEmit`; final `npm run check` combines independent lint, typecheck and tests. A real package manifest/test entry is a build prerequisite, not a previously existing fact.

## Checks

### S1 - Clients use a generic shared tool gateway · estimated 5 product/fixture files · 36 KB · ~9k tokens

**C1** - HTTP and stdio upstream transports both serve unrelated MCP tool calls through the shared local gateway and protocol-2025-compatible stdio bridge; SDK legacy stateless HTTP POST returns the expected fixture result without promising SSE GET (MCP-01, AC 1).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C01 transports$' test/integration.test.mjs`

**C2** - One selected server retains arbitrary tool names, schemas, annotations/metadata, text/non-text/structured results and meaningful SDK-exposed server instructions; capabilities advertise tools only (MCP-01, AC 2).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C02 tool fidelity$' test/integration.test.mjs`

**C3** - Two concurrent CLI connect clients for one config/server use one daemon; closing either leaves the other usable; authenticated stop terminates daemon/upstream children and repeated stop succeeds (MCP-01, AC 3).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C03 shared lifecycle$' test/integration.test.mjs`

### S2 - Operator-controlled reuse and quota recovery · estimated 3 product/test files · 28 KB · ~7k tokens

**C4** - Empty safe-tool allowlist forwards each invocation at most once with zero cache hits, zero coalescing and zero retry/profile failover; readOnlyHint alone grants none of those permissions (CACHE-01, AC 4).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C04 explicit policy$' test/router.test.mjs`

**C5** - Eligible persisted cache defaults to 604800 seconds, misses at expiry/corruption, isolates server/credential identity/tool/canonical args, invalidates credential rotation, and TTL 0 disables cache without disabling safe-tool policy (CACHE-01, AC 5).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C05 cache boundaries$' test/router.test.mjs`

**C6** - Equivalent simultaneous eligible reads cause one real router upstream invocation and return its result to every waiter; distinct identities remain separate and failure clears pending work (CACHE-01, AC 6).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C06 read coalescing$' test/router.test.mjs`

**C7** - Explicitly eligible HTTP 429 and configured isError quota patterns try ordered profiles once each, stop on first success or final failure, and attribute cached fallback result to actual responding identity (ROUTE-01, AC 7).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C07 quota failover$' test/router.test.mjs`

**C8** - Unlisted tools, annotation-only tools, HTTP 401/403/5xx, network errors and unmatched tool errors make one actual upstream attempt and zero automatic retries/profile failover, including 401/403 with quota-matching text; counted provider calls detect hidden SDK retry amplification (ROUTE-01, AC 8; SEC-04).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C08 no unsafe retry$' test/router.test.mjs`

**C9** - Transport failure and isError results create zero successful cache entries; a subsequent eligible call reaches the provider and never returns a cached failure or stale substitute (CACHE-01, AC 9).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C09 failure is not cached$' test/router.test.mjs`

### S3 - Private local operation and safe public delivery · estimated 5 product/test/docs files · 36 KB · ~9k tokens

**C10** - Validate/connect reject missing env references, invalid policy/transport or missing config/server flags with exit 1 and zero upstream calls; valid HTTP headers/stdio env resolve only intended profile, and status reports secret-free local counters/availability (SEC-01, AC 10).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C10 configuration and status$' test/config.test.mjs`

**C11** - Created state directories/files are 0700/0600; symlinked parent/config/token/cache paths are rejected without changing target sentinels, and credential values appear in no cache key/credential metadata (SEC-01, AC 11).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C11 private filesystem$' test/config.test.mjs`

**C12** - Gateway binds loopback, rejects missing/wrong bearer and disallowed Host/Origin before upstream invocation, accepts authorized SDK clients and authenticated status/stop, and covers its `/mcp` transport response statuses (SEC-02, AC 12).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C12 local gateway authorization$' test/integration.test.mjs`

**C13** - Synthetic secrets reflected in HTTP/stdio/config failures are absent from stderr and CLI diagnostics; stdio stdout remains protocol-only and daemon credentials never appear in connect/status output (SEC-03, AC 13).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C13 redacted diagnostics$' test/integration.test.mjs`

**C14** - Package dry-run and tracked source/history inspection contain only synthetic examples, exclude private state/credentials/logs, preserve required borrowed-code license attribution, and make no edits outside this project (SEC-03, AC 14).
Proof: `node --test --test-concurrency=1 --test-name-pattern='^C14 public package$' test/config.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| Upstream transport (2) | HTTP C1 · stdio C1 | - |
| Tool fidelity (7) | name C2 · schema C2 · metadata C2 · text C2 · non-text C2 · structured content C2 · server instructions C2 | - |
| CLI (4) | connect C3 · validate C10 · status C10 · stop C3 | - |
| Client lifecycle (5) | concurrent start C3 · first disconnect C3 · second remains usable C3 · authenticated stop C3 · repeated stop C3 | - |
| Eligibility decision (3) | absent allowlist C4 · annotation-only C4 · explicit safe policy C7 | - |
| Cache identity dimension (5) | server C5 · resolved credential identity C5 · credential rotation C5 · tool C5 · canonical arguments C5 | - |
| Cache TTL/record (5) | default 604800 C5 · before expiry C5 · exact expiry C5 · corrupt entry C5 · TTL 0 C5 | - |
| Pending request decision (4) | same key C6 · distinct identity C6 · shared success C6 · cleared failure C6 | - |
| Quota attempt outcome (5) | HTTP 429 C7 · matched tool pattern C7 · ordered fallback success C7 · exhausted profiles C7 · cache actual identity C7 | - |
| Non-retry decision (7) | unlisted C8 · hint-only C8 · HTTP 401 with quota text C8 · HTTP 403 with quota text C8 · HTTP 5xx C8 · network failure C8 · unmatched tool error C8 | - |
| Failure caching (2) | transport failure C9 · isError=true C9 | - |
| Configuration decision (6) | missing env C10 · invalid policy C10 · invalid transport C10 · missing flags C10 · HTTP header refs C10 · stdio env refs C10 | - |
| Private paths (5) | ordinary 0700/0600 C11 · symlink parent C11 · symlink config C11 · symlink token C11 · symlink cache record C11 | - |
| Gateway guards (6) | loopback bind C12 · missing bearer C12 · wrong bearer C12 · disallowed Host C12 · foreign Origin C12 · authorized control C12 | - |
| `HTTP /mcp` statuses (7) | 200 C12 · 202 C12 · 400 C12 · 401 C12 · 403 C12 · 405 unsupported method C12 · 500 C12 | - |
| `GET /_router/status` statuses (3) | 200 authorized C12 · 401 missing/wrong bearer C12 · 403 disallowed Host/Origin C12 | - |
| `POST /_router/stop` statuses (3) | 200 authorized C12 · 401 missing/wrong bearer C12 · 403 disallowed Host/Origin C12 | - |
| Secret-bearing source (3) | config C13 · HTTP failure C13 · stdio failure C13 | - |
| Public artifacts (4) | synthetic examples C14 · package dry-run C14 · tracked history C14 · license attribution C14 | - |
| Startup assembly (2) | shipped CLI daemon/bridge C1 · direct router test assembly C4 | - |
| Landing doors (2) | SDK/runtime contract C1 · selected-server/profile/policy/TTL config contract C10 | - |
| Relation entities (4) | Server C10 · Profile C5 · Tool policy C4 · Cache entry C5 | - |
| Security abuse cases (5) | ABUSE-001 C12 · ABUSE-002 C8 · ABUSE-003 C5 · ABUSE-004 C11 · ABUSE-005 C13, C14 | - |

Claims crossing CLI/MCP boundaries have CLI/SDK proofs: C1, C2, C3, C10, C12, C13, C14. C4–C9 assert actual router decisions with counted fake-provider I/O, not copied predicates. Integration C1/C3 proves transport and process lifecycle risk distinct from those decision tables. Config C11 uses real temporary filesystem permissions and symlink targets.

## Test policy

This empty project has no existing analogue or testing guidelines. Apply these rows to this feature only; no global test policy file is added.

| Code shape | Required proofs | Coverage expectation |
| --- | --- | --- |
| Configuration/file/security decisions | Real CLI/file boundary proof | Every listed accepted and rejected table member, with an authorized/successful control |
| Cache/policy/retry decisions | Router-owner tests observing provider call counts, result identity and real persistence | Every Coverage table member; no private predicate-only assertions |
| Transport/bridge/daemon lifecycle | Actual SDK clients, HTTP upstream and separately launched stdio fixtures | Both transports, two concurrent clients, disconnect/reconnect/explicit stop outcomes |
| Protocol pass-through instrumentation | Consumer fidelity proof C2 | No duplicated per-function suite |
| Public artifact contract | Package dry-run plus repository/history inspection | Synthetic values only; no scanner may read real operator private files |

Evidence: pre-build repository contains specifications only; manifest/test files are authorized prerequisites. Exact branch counts per product file cannot exist before code; verifier must recompute them from landed source and reconcile all decision rows against Coverage. Proposed input decision counts: eligibility 3, cache identity 5, cache lifecycle 5, pending 4, quota outcome 5, non-retry 7, config 6, local guards 6. These are enumerated contracts, not fabricated source branch counts.

Cost: 14 primary named tests across 3 owner files, using Node's standard runner and shared synthetic server fixtures. No production-only test exports/flags are required. A second level is added only where its distinct transport/filesystem/process risk is not reachable by router-owner tests. Tests protect independent behavior; they must fail when that behavior is broken and survive internal module renames.

## Swept

- validation: C10, C11, C12
- failure modes: C8, C9, C13
- idempotency: C4, C7, C8 - unlisted tools never retry; each explicitly safe fallback identity tried once
- authorization: C8, C12
- concurrency: C3, C6
- data lifecycle: C5, C9, C11
- dependency failure: C7, C8, C9
- state transitions: C3, C5, C6, C7
- observability: C10, C13, C14

## Handoff

- Estimate: S1 36 KB / 4 ≈ 9k tokens; S2 28 KB / 4 ≈ 7k; S3 36 KB / 4 ≈ 9k. Total estimated touched files 100 KB / 4 ≈ 25k, below standard 150k budget. Empty source means these are planning estimates, not measured source sizes.
- One source author owns whole slices sequentially; no partial slice split. This artifacts-only author does not implement product code or write verification.
- Build prerequisite: create the agreed manifest, lockfile and standard Node test entries; compile before named Proof commands. Exact publication inspection runs again on final commits before public push. No real keys/configs/logs may be read or copied into fixtures or scanner input.
- Closure requires all 14 named proofs, `npm run check`, package/history secret review and independent standard-profile verification at final HEAD. Source author records actual gate commands, results and commit boundary, then stops.
