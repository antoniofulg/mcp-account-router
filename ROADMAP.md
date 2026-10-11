# Deferred decisions

The current release proxies tools only. These items are future design decisions,
not supported features or commitments:

- Resources and prompts: define discovery, subscriptions and identity isolation
  before exposing additional capabilities.
- OAuth: decide credential acquisition, consent, refresh and storage boundaries
  before adding interactive authentication.
- Extended callbacks and sessions: define sampling, elicitation, tasks and
  sessionful SSE lifecycle behavior before advertising them.
- Cache eviction and observability: choose bounded storage and useful local
  metrics without persisting credentials or sensitive tool arguments.

No roadmap item changes the current explicit safe-tool policy or retry rules.
