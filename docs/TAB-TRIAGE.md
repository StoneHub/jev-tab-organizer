# Tab triage and a useful saved-link list

Status: product direction captured 2026-09-25; implementation has not started. First cloud task is a source-backed design, followed by one selected implementation slice.

## Desired experience

The browser accumulates active work, completed research, temporary status pages and useful references. Help the user distinguish what still needs attention, what is worth saving, and what can be closed. Keep common destinations easy to reopen using the user's context about current projects and recurring needs.

Current `main` at `dfc0468` contains a working MV3 topic organizer. `extension/core.js` classifies eligible tabs into six topics; `extension/dashboard.js` previews groups, applies grouping and ungroups the last session batch. It does not close tabs, persist a saved-link library, or infer task completion. The optional Jev gateway receives selected titles and hostnames, not page contents or full URLs. Tests and packaging passed locally during preparation. This proposal extends that product, not a separate extension shell.

## Three linked feature ideas

### 1. Reviewable keep / save / close suggestions

Offer lifecycle decisions alongside or instead of the existing topic groups: keep open for active work, save for later, or suggest closing. “Unsure” should leave a tab alone. Completed research, stale status pages and apparent duplicates are clues, not proof that a tab is disposable. Show an understandable reason and let the user change each decision before applying it.

The first implementation slice should be a preview with synthetic scenarios. Actual closing is a later explicit action, with revalidation against changed tab identity, URL and window. Define partial failures and a recovery record before enabling it. Reopening a URL cannot restore unsaved forms, application state or exact tab history; do not call it full undo. Save-and-close must persist the saved record before closing. Preserve existing protections for pinned, incognito, already grouped and non-web tabs until an intentional design changes them.

### 2. Saved links and quick return

A small persistent list should retain useful research and common destinations without requiring the tab to stay open. Design add/edit/remove/reopen, project or topic grouping, and a clear distinction between a reusable favorite and a one-off saved reference. Consider deduplication without losing meaningful URL parameters or fragments. Start with local extension storage; browser bookmarks or sync are explicit alternatives to evaluate, not automatic new permissions.

Store the actual reopenable URL locally. The existing gateway's reduced hostname payload cannot recreate it. Keep local persistence separate from what is sent to Jev. Include persistence across browser restart, schema migration, empty/error states, and behavior when the browser cannot reopen a URL.

### 3. Personal context that improves suggestions

Start by comparing user-maintained project labels, “always keep” rules and saved favorites with learning from accepted/corrected suggestions. Explain which signal drove a decision. Let the user inspect, correct and clear retained context; support stale/retired projects and conflicting rules. Define deterministic fallback when context is absent or Jev is unavailable.

Jot context could be a later optional integration. A browser extension does not automatically gain access to Jot transcripts or agent conversations. Propose the minimum useful contract only if the first experience needs it. Background page/history capture, automatic provider transmission and broad new permissions are not part of this initial slice.

## Cloud design acceptance

Read `docs/CLOUD-WORK.md` and the focused source. Deliver `docs/plans/tab-triage-design.md` with a concrete before/after interaction, state/storage ownership, two or three alternatives and one recommendation. Include at least eight synthetic tab/context cases: active work, finished research, transient status, duplicate-looking URLs with meaningful differences, frequent destination, protected tab, changed-since-preview tab, and uncertain relevance. Distinguish authored expectations from measured Jev quality.

Map the result into at most three implementation slices linked to the feature issues. Each needs owned files, offline tests, real-browser acceptance and a completion condition. Identify the first user-visible slice and the decisions still needing the user. End at that design; do not change production code, gateway contracts, permissions, or deploy anything in this task.
