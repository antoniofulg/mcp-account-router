# Security boundaries

This is a local, single-operator tools gateway. Authorized clients share the
operator's upstream authority. HTTP and stdio tool definitions and results are
untrusted data; configured child executables are trusted code with operator privileges.
The independent [verification report](verification.md) records the checks below
at source revision `a46816d90263d75cadf0caa0cf280804168eab38`.

| Threat                                                          | Implemented boundary                                                                                                                   | Proof                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Unauthenticated local access or browser rebinding               | Loopback bind, bearer, Host and Origin guards on MCP and control routes                                                                | C12                            |
| Provider hints authorize repeated mutations or switch authority | Empty-by-default named safe-tool policy; no automatic retry for unlisted tools, 401/403, network or 5xx failures                       | C4, C7, C8                     |
| Results cross server, tool or account identities                | Cache and pending keys include server, resolved credential identity, tool and canonical arguments; rotation invalidates prior identity | C5, C6                         |
| Private paths redirect writes or expose data                    | Private POSIX modes, no-follow file access and rejected symlinked paths                                                                | C11                            |
| Reflected secrets reach diagnostics or public artifacts         | Configured-secret redaction, suppressed child stderr, synthetic-only fixtures and explicit package files                               | C13, C14                       |
| Failure amplifies attempts or strands work                      | Bounded ordered quota fallback, cleared failed pending requests and explicit shared-daemon shutdown                                    | C3, C6, C7, C8, C9             |
| A configured executable is malicious                            | Explicit argv without a shell; operator owns executable and dependency trust                                                           | C10; documented trust boundary |

These controls do not defend against full compromise of the same OS user.
Safe-tool policy requires manual review of side effects; annotations cannot establish
safety. Cached data may outlive remote ACL changes until its TTL, so disable or clear
cache after access changes. Successful tool content is forwarded unchanged and may
contain sensitive data; configured-secret echoes are excluded from persistent cache.
No general rate, spending, storage-size or sandbox guarantee is provided. POSIX privacy
is supported on macOS/Linux. OAuth, multi-user hosting and advanced MCP callbacks
remain outside the implemented scope; see the [roadmap](../ROADMAP.md).
