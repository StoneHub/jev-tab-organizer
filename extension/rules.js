// Keep rules the user creates in the Tidy view (#4). Each rule has its own storage.local key, so two open dashboards never
// overwrite each other's rules. `storage` is chrome.storage.local or anything with the same get/set/remove.
const PREFIX = 'rule:';
const valid = rule => rule?.action === 'keep' && typeof rule.id === 'string' && typeof rule.host === 'string' && rule.host &&
  typeof rule.pathPrefix === 'string' && rule.pathPrefix.startsWith('/') && Number.isFinite(rule.createdAt) && typeof rule.retired === 'boolean';

export async function loadRules(storage) {
  const all = await storage.get(null);
  return Object.entries(all).filter(([key, rule]) => key === PREFIX + rule?.id && valid(rule)).map(([, rule]) => rule)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Adds "always keep" for the tab's site, unless an active rule for the same site and path already exists. Returns the rule.
export async function keepSite(storage, url, now = Date.now()) {
  const host = new URL(url).hostname;
  const existing = (await loadRules(storage)).find(rule => rule.host === host && rule.pathPrefix === '/');
  const rule = existing ? {...existing, retired: false} : {id: crypto.randomUUID(), action: 'keep', host, pathPrefix: '/', createdAt: now, retired: false};
  await storage.set({[PREFIX + rule.id]: rule});
  return rule;
}

export async function setRetired(storage, rule, retired) { await storage.set({[PREFIX + rule.id]: {...rule, retired}}); }
export async function removeRule(storage, id) { await storage.remove(PREFIX + id); }
export async function clearRules(storage) { await storage.remove((await loadRules(storage)).map(rule => PREFIX + rule.id)); }
export const isRuleKey = key => key.startsWith(PREFIX);
