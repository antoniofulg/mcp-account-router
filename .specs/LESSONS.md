# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Enable caching for every compared tool and rotate an environment-backed credential before asserting cache identity isolation through provider calls.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `cache` · harmful: 0
- features: generic-router
- evidence: VR-001; test/router.test.mjs:33,54-55; src/router.ts:18 (cache)
- last seen: 2026-10-11T01:51:36Z

### L-002 - Assert denied statuses at every declared HTTP control route rather than inferring them from a shared guard tested on another route.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `gateway` · harmful: 0
- features: generic-router
- evidence: VR-002; plan.md:36-38; test/integration.test.mjs:157-173,226-228,263-265 (gateway)
- last seen: 2026-10-11T01:51:36Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
