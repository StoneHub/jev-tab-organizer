# Cloud task: saved links without closing tabs

Issue: [#3](https://github.com/StoneHub/jev-tab-organizer/issues/3). Design: [slice 2](../plans/tab-triage-design.md). PRs #5 and #6 are merged; record the live main commit and overlapping PRs before starting.

## Assignment

Implement only slice 2: a Saved view and explicit Save action that retain full URLs locally and reopen them in the current window. Support titles, optional project labels, reusable favorites versus one-off references, edit/remove, empty/error states, and JSON export. Saving never closes, groups or moves a tab. Preserve the existing topic view, Tidy preview and keep rules.

Read `docs/CLOUD-WORK.md`, the design's storage and slice-2 sections, `extension/core.js`, `extension/rules.js`, `extension/dashboard.js`, `extension/dashboard.html`, `extension/styles.css`, and current tests. Own `extension/saved.js`, `test/saved.test.mjs`, the Saved view in the dashboard, necessary asset/package checks, README and the focused browser smoke additions. Do not expand permissions, introduce dependencies, alter the gateway, add Jot ingestion, call paid models, or implement closing/recovery.

## Requirements and evidence

- Store one `link:<id>` per full HTTP(S) URL record in `chrome.storage.local`. Normalize only scheme/hostname/default port. Different meaningful queries/fragments remain separate. Deduplication must preserve existing favorite and project values. Define a deterministic record key or equivalent protection so simultaneous saves in two dashboards cannot create competing duplicate records.
- Implement the design's versioned schema. A newer unsupported version is read-only; do not overwrite or migrate it. Existing `rule:*`, gateway settings and session grouping records must survive. Handle malformed records and quota/write failures visibly.
- Reload links after `storage.onChanged`. Per-record updates must not overwrite other links. Record successful reopen use only when creation succeeds; show failures without pretending the page loaded. Favorites and research remain distinguishable.
- Export all saved records to a local JSON artifact. Add a parse/serialization round-trip test; no import UI or bookmarks permission is needed in this slice.
- Use fake Chrome storage/tabs APIs for deterministic unit tests: add/edit/remove; exact-URL dedupe; distinct query/fragment; concurrent saves; failed write; newer schema; other keys untouched; reopen success/failure. Include focused smoke coverage if an isolated Chromium runtime is already installed. Never use real user tabs or metadata.

## Runner budget and stop conditions

Start with `node --version`, `git status --short`, `npm test`, `npm run check` and `npm run package`. Runtime and tests are dependency-free; no `npm install` is required. Allow five minutes and one evidence-backed setup correction. Do not install Xcode, macOS frameworks, browsers or a proxy to unblock this task. If browser automation is unavailable, finish portable implementation/tests and list the exact pending smoke command. Do not poll hourly, start a watcher, or wait for the Mac integrator.

Run the targeted tests, then the existing complete portable suite/check/package and `git diff --check`. Return a scoped PR linked to #3 with exact commit, actual test results, explicit deviations and pending real-browser gates. Do not merge automatically or treat a check comment as approval to merge; the Mac integrator owns review, merge and installation.

## Local acceptance after cloud handoff

The Mac integrator runs an isolated real-browser save/restart/reopen check; validates storage across an unpacked-extension reload; exercises two dashboards and error states; and verifies nothing closes. Installed user-profile proof is separate from a packaged ZIP or an isolated browser pass. Edge's extension-manager page was blocked by the local automation URL policy during slice-1 delivery, so that install step may require the user to load the repository's `extension/` folder manually. No workaround should bypass that policy.
