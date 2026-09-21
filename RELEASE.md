# v0.1.0 — A little order. A lot more focus.

First downloadable Chrome prototype: review open tabs, adjust categories, then create color-coded groups. Local sorting works without a key or network. Pinned/private/already-grouped tabs are protected; no tabs are closed.

## Install

Download **jev-tab-organizer-0.1.0-unpacked.zip**, extract it, enable Developer mode at `chrome://extensions`, click **Load unpacked**, and select the extracted folder containing `manifest.json`. Keep the folder in place. Desktop Chrome is required.

## Optional Jev

The source repo includes a real TypeSafe Choice adapter and a loopback development gateway. Bring your own server-side TypeSafe key; review README setup instructions. The extension sends only explicitly approved selected tab titles/domain metadata, never full URLs or page contents. Live Jev inference has not been acceptance-tested with a production key.

## Verification

- Nine unit/contract tests passed.
- Manifest V3, required files and JavaScript syntax checks passed.
- Real isolated Chromium smoke: extension loaded, five tabs grouped, pinned tab and preexisting group preserved, last batch ungrouped, changed URL skipped, zero dashboard errors.
- Unpacked ZIP inspected: extension-only files, no server code or credentials.

## Known limits

Preview prototype, not a Chrome Web Store release. Ungroup removes only the last batch's grouping and does not restore prior order. No unattended grouping or public hosted gateway. The first smoke attempt timed out on fixture navigation; fixtures now await intercepted navigation before preview. A subsequent full smoke run passed.
