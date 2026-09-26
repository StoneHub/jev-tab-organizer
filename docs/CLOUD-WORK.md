# Cloud work: Jev Tab Organizer

The next product direction is reviewable tab triage, saved links and personal context. Read [the brief](TAB-TRIAGE.md). This repository is the intended base: its history contains the original MV3 organizer, release proof and archive fix, rather than an abandoned research page. The product now has topic grouping and a read-only Tidy preview with explicit keep rules (PRs #5 and #6). Saved links and tab closing remain unimplemented. The next portable task is [saved links](cloud-tasks/saved-links.md).

## Portable baseline

Preparation baseline: `dfc0468` on 2026-09-25. Record the runner's branch/commit and dirty state, then inspect the assigned issue and overlapping PRs. Git, Node 22+ and `zip` suffice for the current checks. No npm install is needed for the existing application/test graph.

```sh
npm test
npm run check
npm run package
git diff --check
```

These passed locally: 10 tests, source/manifest checks and packaging. PR #6 passed 15 tests plus source/package checks on hosted Linux and the Mac. An isolated Chromium MV3 smoke passed on both hosts, including preview reasons, rule persistence and unchanged tabs. User-profile Edge installation remains a separate manual gate. Package output under `dist/` is an artifact, not a published release.

Read `README.md`, `package.json`, `extension/manifest.json`, `extension/core.js`, `test/core.test.mjs` and `test/package.test.mjs` first. For gateway work, add `server/proxy.mjs`. Tests use fixtures; no TypeSafe credentials, real tab metadata or live provider calls are needed. Preserve current permissions and explicit preview/apply behavior unless the approved feature specifically changes them.

Allow five minutes for preflight and one evidence-backed correction; report repeated failure rather than changing dependencies or tests to conceal it. Personal Mac paths/MCP services are not setup requirements. Avoid launching the optional proxy for static/test work. Optional Chromium acceptance needs a separately prepared isolated browser environment; do not download browsers during an unrelated task. Any process started for an authorized test must be stopped before returning.

## First design task

> Design the tab-triage experience in docs/TAB-TRIAGE.md: decide what to keep open, save for later, or close, and make common saved links easy to reopen. Read docs/CLOUD-WORK.md and the focused source it identifies. Explain the current user flow, compare two or three concrete options, and recommend the smallest useful interaction. Identify required extension permissions, state ownership, offline behavior, backend needs, and what needs real browser proof. Write a short design with source anchors, a textual before/after interaction, and at most three independently testable implementation slices. Resolve only choices the existing product/context supports; list the remaining user decisions. Do not implement, deploy, call a paid model, or expand permissions during this review.

For subsequent implementation, assign one slice with an issue, owned files, exact acceptance checks and return artifact. Keep fixture correctness separate from real Jev quality, browser acceptance, installation and store distribution. The local integrator owns review/merge and any separately authorized installed test.
