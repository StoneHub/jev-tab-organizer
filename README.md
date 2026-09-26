# Jev Tab Organizer

**A little order. A lot more focus.** A dependency-free Manifest V3 Chrome extension that turns open tabs into reviewable groups. Works privately and offline out of the box; optional Jev semantic classification uses a gateway you control.

## Download and install

1. Open [Releases](https://github.com/StoneHub/jev-tab-organizer/releases/latest).
2. Download **jev-tab-organizer-0.1.0-unpacked.zip** from Assets (not the GitHub source archive).
3. Extract it into a permanent folder. Do not delete/move that folder while using the extension.
4. In desktop Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the extracted `jev-tab-organizer-0.1.0` folder containing `manifest.json`.
5. Pin the extension and click its toolbar button. It opens an organizer for that window.

From source, select the repository's **extension/** folder instead. No npm install or build is required. Chrome on iOS/Android does not support loading unpacked desktop extensions. Edge/other Chromium browsers are not yet acceptance-tested.

## Use it

- Review the local groups: Build & code, Read & learn, Work & connect, Shop & compare, Watch & play, Everything else.
- Uncheck anything you want left alone, or change its proposed group with the dropdown.
- Click **Create groups**. Chrome may reorder tabs to put group members together.
- **Ungroup last batch** removes grouping from tabs still in that batch's groups; it does **not** restore their previous order. Only the most recent batch is retained, until the browser session ends.
- **Tidy up** shows which tabs look finished (Close), which to keep for later (Save and close) and which to leave open, with the reason for each. You can change any decision or choose **Always keep this site**, and inspect, retire or clear those rules. This version only suggests: it closes and saves nothing. See [the design](docs/plans/tab-triage-design.md) once #5 merges.
- Refresh to get a fresh local plan. Pinned tabs, private/incognito tabs, existing groups and non-web pages are always excluded. Tabs whose URL/title/window/group status changed since preview are skipped.

No tabs are closed, no groups are collapsed, and nothing runs on a timer. The extension automatically chooses categories, but applying the plan is always user-triggered. Multiple dashboard tabs can view the same browser; use one at a time.

## Privacy and permissions

- `tabs`: inspect open tab titles/URLs **locally**. `tabGroups`: create/style groups. `storage`: remember the gateway URL and a session-only last-batch record of tab/group IDs.
- No content scripts, page access, cookies, form fields, passwords, history permission, telemetry, analytics, remote code or default network requests.
- Optional host access is requested only when you click **Send selection to Jev**, for your configured gateway origin. The manifest declares HTTPS origins and HTTP loopback as *optional*, not pre-granted access. Revoke access through Chrome's extension settings when finished.
- Explicit per-selection consent is required. Only selected tab IDs, titles (up to 240 characters), and hostname are sent. Paths, query strings and fragments are excluded. **Titles/domains can still be sensitive**, so uncheck private tabs before sending. This prototype does not attempt unreliable automatic secret redaction.
- API keys belong on the gateway server. Never put a TypeSafe key in the extension or gateway URL. The bundled proxy logs neither titles nor request bodies.

## Optional Jev gateway

Local sorting is usable immediately. To enable live Jev, supply your own TypeSafe key to the **server environment**, not the extension. Node 22+ is required. Set `TYPESAFE_API_KEY` securely in that environment, and set `EXTENSION_ORIGIN` to `chrome-extension://` followed by the extension ID displayed in `chrome://extensions`.

Run `npm run proxy`, enter `http://127.0.0.1:4318/classify` in the extension, approve sharing the selected metadata, and click **Send selection to Jev**. The sample server binds only to loopback and accepts only the configured extension Origin and expected Host/path. It allows one in-flight request and a three-second interval. It does not persist metadata. Origin checking protects against ordinary web-page callers, **not hostile local processes**. Do not expose this development proxy publicly.

The server makes a real `POST https://api.typesafe.ai/v1/systemone` with `model: "jev-latest"`, server-side Bearer authentication, structured tab state, and one **Choice** question per tab in the same request. Choices are the six known categories, including `other`; questions treat tab titles as evidence, not instructions. Response `answers.tab_<id>.choice` and `.confidence` are normalized and validated. Confidence below 0.65 falls back to local sorting; that threshold is a prototype policy, not an accuracy guarantee. Timeout, non-2xx or malformed output leaves the existing local preview intact. No live model latency/accuracy claims have been measured.

### Gateway wire contract

Request: `POST`, JSON, omitted browser credentials, max 100 tabs:

```json
{"version":1,"tabs":[{"id":7,"title":"Introduction to TypeScript","domain":"www.typescriptlang.org"}]}
```

Response (exactly one unique, known tab ID per input):

```json
{"version":1,"assignments":[{"id":7,"category":"build","confidence":0.9}]}
```

Categories: `build`, `learn`, `work`, `shop`, `watch`, `other`. Confidence must be a finite number in [0,1]. Unknown/duplicate/missing IDs or categories reject the entire response. Arbitrary strings never become executable code or HTML.

An alternative hosted HTTPS gateway must implement this contract, authorize callers, enforce quotas and payload limits, protect its API key, and establish an explicit data-retention policy. The extension does not implement hosted account authentication. Do not deploy the development proxy as an unauthenticated paid public endpoint.

Reference API docs (checked 2026-09-21): [HTTP API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [classification with confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence). TypeSafe also has Score (ordered rating) and Noul (yes probability) primitives; this use case needs Choice, not generated text or fabricated scores.

## Develop / verify / package

```sh
npm test
npm run check
npm run package
```

Node's built-in test runner verifies protected tab eligibility, URL metadata stripping, fallback policies, response validation, and the server adapter against fixture HTTP responses. Packaging uses the system `zip` command and includes **only extension files**, never server files, secrets or dependencies. Release zip is produced under `dist/`. JavaScript edits require reloading the extension in `chrome://extensions`, then reopening its dashboard.

Optional real Chromium smoke test: install Playwright separately (`npm install --no-save playwright`, `npx playwright install chromium`) and run `node scripts/browser-smoke.mjs`. It uses an isolated temporary profile and synthetic intercepted pages, checks actual MV3 grouping/ungrouping and stale-tab protection, and saves `dist/browser-smoke.png`. The runtime extension itself has no dependencies.

Manual browser acceptance: open several normal test tabs, a pinned tab, and an existing group. Confirm preview excludes protected tabs; change/uncheck choices; create groups; ungroup last batch. Close or navigate a tab after preview and ensure it is skipped. Test a failing gateway: local preview must remain usable. A real TypeSafe key is required to verify live semantic results; fixture tests alone do not prove live Jev operation.

### Reference extension lessons

Reviewed StoneHub's existing `webDevFeedbackExt`: retained its plain JavaScript MV3 structure, local preferences, simple Load unpacked flow, and small dependency surface. This extension uses its own isolated dashboard rather than injecting page overlays, so page CSS, SPA navigation, cross-origin iframes and z-index collisions are out of scope. No missing icon assets are referenced. No source files were copied or changed in the reference repo.

## Prototype limits / next steps

Local categories are intentionally simple keyword rules, not semantic AI. No continuous background organization, undo order restoration, saved workspaces, Firefox support, Chrome Web Store distribution or production gateway deployment yet. Test live Jev with consented example tabs, measure classification quality and latency, then improve taxonomy and confidence policy from actual results.

## Cloud task preparation

See [cloud work](docs/CLOUD-WORK.md) for supported runner checks, task boundaries and local acceptance gates.
