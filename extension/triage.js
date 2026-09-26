import {localCategory} from './core.js';
// Local keep / save / close suggestions for eligible tabs (docs/plans/tab-triage-design.md). Pure: nothing here reads or changes a tab.
export const RECENT_MS = 60 * 60 * 1000;
export const STALE_MS = 3 * 24 * 60 * 60 * 1000;
// Status pages worth closing once seen: CI runs and jobs, checkout and order confirmations, sign-in and redirect pages.
const TRANSIENT_URL = [/\/actions\/runs\/\d/, /\/pipelines\/\d/, /\/-\/jobs\/\d/, /\/checkout\/(success|complete|confirmation)/i,
  /\/orders?\/[^?#]*confirm/i, /\/(login|signin|sign-in|oauth|authorize|callback)(\/|\?|#|$)/i];
const TRANSIENT_TITLE = /^(order (confirmed|received|placed)|payment (successful|received)|signed in)\b/i;
const STALE_TOPICS = new Set(['learn', 'build']);

function duration(ms) {
  const minutes = Math.round(ms / 60000), hours = Math.round(ms / 3600000), days = Math.round(ms / 86400000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${days} days`;
}

// The active keep rule with the longest matching path prefix, or undefined.
export function matchRule(tab, rules) {
  const url = new URL(tab.url);
  return rules.filter(rule => !rule.retired && rule.host === url.hostname && url.pathname.startsWith(rule.pathPrefix))
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
}

// Among identical addresses, keep the most recently opened copy, or the last in tab order when recency is unknown.
function newer(a, b) {
  return Number.isFinite(a.lastAccessed) && Number.isFinite(b.lastAccessed) ? a.lastAccessed > b.lastAccessed : (a.index ?? 0) > (b.index ?? 0);
}

// One {id, decision: 'keep' | 'save' | 'close', reason, signal} per tab, in order. The first matching rule wins; uncertainty keeps.
export function triage(tabs, {now = Date.now(), rules = [], favorites = new Set()} = {}) {
  const keepers = new Map(), counts = new Map();
  for (const tab of tabs) {
    counts.set(tab.url, (counts.get(tab.url) ?? 0) + 1);
    if (!keepers.has(tab.url) || newer(tab, keepers.get(tab.url))) keepers.set(tab.url, tab);
  }
  return tabs.map(tab => {
    const decide = (decision, reason, signal) => ({id: tab.id, decision, reason, signal});
    if (tab.audible) return decide('keep', 'Playing audio', 'audible');
    if (tab.active) return decide('keep', 'Current tab', 'active');
    const rule = matchRule(tab, rules);
    if (rule) return decide('keep', `Your rule: always keep ${rule.host}${rule.pathPrefix === '/' ? '' : rule.pathPrefix}`, 'rule');
    if (counts.get(tab.url) > 1 && keepers.get(tab.url) !== tab) return decide('close', 'Same address is open in another tab', 'duplicate');
    if (!Number.isFinite(tab.lastAccessed)) return decide('keep', 'No recent-use information', 'unknown');
    const idle = Math.max(0, now - tab.lastAccessed);
    if (idle < RECENT_MS) return decide('keep', idle < 60000 ? 'Opened just now' : `Opened ${duration(idle)} ago`, 'recent');
    if (TRANSIENT_URL.some(pattern => pattern.test(tab.url)) || TRANSIENT_TITLE.test(tab.title || '')) {
      return decide('close', `Status page, last opened ${duration(idle)} ago`, 'transient');
    }
    if (favorites.has(tab.url)) return decide('close', 'In Quick return; one click to reopen', 'favorite');
    if (idle >= STALE_MS && STALE_TOPICS.has(localCategory(tab))) return decide('save', `Reference not opened for ${duration(idle)}`, 'stale');
    return decide('keep', 'No clear signal', 'none');
  });
}
