# Local acceptance: cloud tab-triage delivery

PRs [#5](https://github.com/StoneHub/jev-tab-organizer/pull/5) and [#6](https://github.com/StoneHub/jev-tab-organizer/pull/6) are merged. Canonical main code revision: `260879e` (PR #6 head `3ca65fbcf4096afb1ee0fedd25e26a29f049160b`).

On the Mac, the exact PR #6 code passed `npm test` (15 tests), `npm run check`, `npm run package` and `git diff --check`. `scripts/browser-smoke.mjs`, using the installed Playwright/Chromium in an isolated temporary profile, passed actual MV3 loading, five-tab grouping, protected tabs/groups, last-batch ungroup, stale navigation skip, Tidy reasons, keep-rule persistence across dashboard reload, identical tab IDs/URLs/groups/pins/order before and after preview, and zero dashboard errors. The test browser was closed in `finally`.

The merged canonical checkout was packaged as `dist/jev-tab-organizer-0.1.0-unpacked.zip`, SHA-256 `ae5d4a6570105385e6a18b957c6d905ff17a14fa918c8da7aeac37650c1d2d75`. This is a local artifact, not a published release. The manifest remains 0.1.0; identify this delivery by the revision above and the visible **Tidy up** control.

User-profile installation is **not complete**. The browser automation URL policy rejected access to Edge's extension manager and expressly prohibited alternate-surface workarounds. No user tabs were changed. The user can load the canonical `extension/` folder using Edge's **Extensions → Developer mode → Load unpacked**, then click the extension and **Tidy up**. This slice only previews decisions and stores explicit keep rules; it never closes or saves tabs. Keep the loaded folder in place.

Not proven: desktop Edge behavior, persisted recency after browser restart/session restore/Memory Saver, and user-profile update behavior. These do not turn the isolated Chromium pass into installed acceptance. Saved links are the next bounded [cloud task](cloud-tasks/saved-links.md); actual closing is a later slice.
