// Saved links (#3, slice 2 of docs/plans/tab-triage-design.md). Each link is one `link:<id>` record in chrome.storage.local, where
// <id> is the SHA-256 of its normalized address: two dashboards saving the same page write the same key, so they can never create
// competing duplicates, and a write to one link never touches another. Nothing here closes, groups or moves a tab, and saved
// addresses are never sent to Jev. `storage` is chrome.storage.local or anything with the same get/set/remove.
export const SCHEMA_VERSION = 1;
const PREFIX = 'link:', SCHEMA = 'schema', EXPORT_FORMAT = 'jev-tab-organizer/saved-links';
export const isLinkKey = key => key.startsWith(PREFIX);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The URL parser lowercases the scheme and host and drops a default port. It removes no parameter and keeps the fragment, so
// `?id=1` and `?id=2`, or `#install` and `#usage`, stay separate links. The path keeps its case; only the browser's own encoding
// applies, so a tab's address is stored exactly as the tab reports it.
export function normalizeUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only web (http or https) addresses can be saved.');
  return url.href;
}
export async function linkId(url) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Version 1 record: {id, url, title, project, favorite, savedAt, lastOpenedAt, openCount, source}. `favorite` marks a reusable
// Quick return destination; otherwise the link is a one-off reference saved for later.
const shaped = link => link !== null && typeof link === 'object' && /^[0-9a-f]{64}$/.test(link.id) && typeof link.url === 'string' &&
  typeof link.title === 'string' && typeof link.project === 'string' && typeof link.favorite === 'boolean' && Number.isFinite(link.savedAt) &&
  (link.lastOpenedAt === null || Number.isFinite(link.lastOpenedAt)) && Number.isInteger(link.openCount) && link.openCount >= 0 &&
  typeof link.source === 'string';
const canonical = link => { try { return normalizeUrl(link.url) === link.url; } catch { return false; } };
async function readable(key, link) { return shaped(link) && key === PREFIX + link.id && canonical(link) && await linkId(link.url) === link.id; }

// A missing schema is version 1 (written with the first link). Any other version, newer or unrecognized, is read-only: it is shown
// but never rewritten or migrated.
function schemaOf(value) { return {version: value === undefined ? SCHEMA_VERSION : value?.version, stored: value !== undefined, readOnly: value !== undefined && value?.version !== SCHEMA_VERSION}; }
export function readOnlyReason({version}) {
  return `${Number.isInteger(version) && version > SCHEMA_VERSION ? `Saved links were written by a newer version of Jev (format ${version})`
    : 'Saved links use a format this version does not recognize'}. They are shown read-only; nothing here will change them.`;
}

// Every saved link in storage, oldest first, plus `unreadable` [{key, value}] for records that failed validation. Those are left untouched.
export async function loadLinks(storage) {
  const all = await storage.get(null), links = [], unreadable = [];
  for (const [key, value] of Object.entries(all)) {
    if (isLinkKey(key)) { if (await readable(key, value)) links.push(value); else unreadable.push({key, value}); }
  }
  links.sort((a, b) => a.savedAt - b.savedAt || a.url.localeCompare(b.url));
  return {...schemaOf(all[SCHEMA]), links, unreadable};
}

async function writable(storage, key) {
  const found = await storage.get([SCHEMA, key]), schema = schemaOf(found[SCHEMA]);
  if (schema.readOnly) throw new Error(readOnlyReason(schema));
  return {schema, value: found[key]};
}
const write = (storage, schema, items) => storage.set(schema.stored ? items : {[SCHEMA]: {version: SCHEMA_VERSION}, ...items});

// Saves a link unless the same address is already saved; an existing record is returned unchanged, keeping its favorite flag and
// project. The new record is read back before success is reported.
export async function saveLink(storage, {url, title = '', favorite = false, project = '', source = 'tab'}, now = Date.now()) {
  const address = normalizeUrl(url), id = await linkId(address), key = PREFIX + id, {schema, value} = await writable(storage, key);
  if (value !== undefined) {
    if (!await readable(key, value)) throw new Error('A saved record for this address could not be read, so it was left untouched.');
    return {link: value, created: false};
  }
  const link = {id, url: address, title: clean(title, 500), project: clean(project, 80), favorite: favorite === true,
    savedAt: now, lastOpenedAt: null, openCount: 0, source};
  await write(storage, schema, {[key]: link});
  if ((await storage.get(key))[key]?.url !== address) throw new Error('The save could not be confirmed.');
  return {link, created: true};
}

async function current(storage, id) {
  const key = PREFIX + id, {schema, value} = await writable(storage, key);
  if (value === undefined) throw new Error('This link is no longer saved. It may have been removed in another window.');
  if (!await readable(key, value)) throw new Error('This saved record could not be read, so it was left untouched.');
  return {key, schema, link: value};
}
// Edits the title, project or favorite flag of the stored record (not a stale copy). The address is the link's identity.
export async function updateLink(storage, id, {title, project, favorite}) {
  const {key, schema, link} = await current(storage, id);
  const next = {...link, ...(title !== undefined && {title: clean(title, 500)}), ...(project !== undefined && {project: clean(project, 80)}),
    ...(favorite !== undefined && {favorite: favorite === true})};
  await write(storage, schema, {[key]: next});
  return next;
}
export async function removeLink(storage, id) { await writable(storage, PREFIX + id); await storage.remove(PREFIX + id); }
export async function recordOpen(storage, id, now = Date.now()) {
  const {key, schema, link} = await current(storage, id), next = {...link, lastOpenedAt: now, openCount: link.openCount + 1};
  await write(storage, schema, {[key]: next});
  return next;
}

// Opens the saved address in a new tab of `windowId`. Use is recorded only after the browser created the tab. A created tab does not
// prove the page loaded, so callers should say a tab was opened, not that the page works.
export async function reopenLink(storage, tabs, link, windowId, now = Date.now()) {
  let tab;
  try { tab = await tabs.create({url: normalizeUrl(link.url), windowId, active: true}); } catch (error) { return {opened: false, recorded: false, error}; }
  try { await recordOpen(storage, link.id, now); return {opened: true, recorded: true, tab}; } catch (error) { return {opened: true, recorded: false, tab, error}; }
}

// Quick return favorites ordered by use; everything else grouped by project (unlabelled last), newest first.
export function arrange(links) {
  const byUse = (a, b) => b.openCount - a.openCount || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.title.localeCompare(b.title) || a.url.localeCompare(b.url);
  const projects = new Map();
  for (const link of links.filter(link => !link.favorite).sort((a, b) => b.savedAt - a.savedAt || a.url.localeCompare(b.url))) {
    projects.set(link.project, [...(projects.get(link.project) ?? []), link]);
  }
  return {favorites: links.filter(link => link.favorite).sort(byUse), later: [...projects].sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b))};
}

// A local JSON copy of every saved record, including unreadable ones, since removing the extension deletes storage.local.
export function serializeExport({version, links, unreadable = []}, now = Date.now()) {
  return `${JSON.stringify({format: EXPORT_FORMAT, exportedAt: new Date(now).toISOString(), schemaVersion: version, links, unreadable}, null, 2)}\n`;
}
export function parseExport(text) {
  const data = JSON.parse(text);
  if (data?.format !== EXPORT_FORMAT || typeof data.exportedAt !== 'string' || !Array.isArray(data.links) || !Array.isArray(data.unreadable)) {
    throw new Error('This is not a Jev saved-links export.');
  }
  if (!data.links.every(link => shaped(link) && canonical(link))) throw new Error('The export contains an invalid saved link.');
  return {schemaVersion: data.schemaVersion, exportedAt: data.exportedAt, links: data.links, unreadable: data.unreadable};
}
