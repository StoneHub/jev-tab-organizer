import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUrl, linkId, loadLinks, saveLink, updateLink, removeLink, recordOpen, reopenLink, arrange, serializeExport, parseExport, isLinkKey}
  from '../extension/saved.js';
import {loadRules} from '../extension/rules.js';

// Synthetic addresses only; no real tabs or browsing metadata.
const now = Date.parse('2026-09-26T12:00:00Z');
// A fake chrome.storage.local. Values are cloned in and out, `fail` makes writes reject like a quota error, and every call yields to
// the event loop so concurrent callers interleave the way two open dashboards would.
function fakeStorage(initial = {}) {
  const data = structuredClone(initial), tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    data, fail: null, writes: 0,
    async get(keys) { await tick(); return structuredClone(keys === null ? data : Object.fromEntries([keys].flat().filter(key => key in data).map(key => [key, data[key]]))); },
    async set(items) { await tick(); if (this.fail) throw new Error(this.fail); this.writes++; Object.assign(data, structuredClone(items)); },
    async remove(keys) { await tick(); if (this.fail) throw new Error(this.fail); this.writes++; for (const key of [keys].flat()) delete data[key]; }
  };
}
function fakeTabs(fail) {
  const created = [];
  return {created, async create(properties) { if (fail) throw new Error(fail); const tab = {id: 500 + created.length, ...properties}; created.push(tab); return tab; }};
}
const linkKeys = storage => Object.keys(storage.data).filter(isLinkKey);
const rule = {id: 'r1', action: 'keep', host: 'jira.example.com', pathPrefix: '/', createdAt: 1, retired: false};

test('only the scheme, host and default port are normalized; queries, fragments and path case stay distinct', async () => {
  assert.equal(normalizeUrl(' HTTPS://Docs.Example.DEV:443/Guide?Tab=1#Install '), 'https://docs.example.dev/Guide?Tab=1#Install');
  assert.equal(normalizeUrl('http://example.com:80'), 'http://example.com/');
  assert.equal(normalizeUrl('https://example.com:8443/a'), 'https://example.com:8443/a');
  for (const url of ['chrome://settings', 'file:///tmp/notes', 'javascript:alert(1)', 'not a url', '']) assert.throws(() => normalizeUrl(url));
  const id = async url => linkId(normalizeUrl(url));
  assert.equal(await id('HTTPS://SHOP.example:443/item?id=1'), await id('https://shop.example/item?id=1'));
  const distinct = ['https://shop.example/item?id=1', 'https://shop.example/item?id=2', 'https://shop.example/item', 'https://shop.example/item?',
    'https://docs.example.dev/guide#install', 'https://docs.example.dev/guide#usage', 'https://docs.example.dev/Guide#install', 'http://shop.example/item?id=1'];
  assert.equal(new Set(await Promise.all(distinct.map(id))).size, distinct.length);
});

test('add, edit and remove keep one key per link and leave rules, gateway and schema-less storage alone', async () => {
  const storage = fakeStorage({gateway: 'http://127.0.0.1:4318/classify', 'rule:r1': rule});
  const {link, created} = await saveLink(storage, {url: 'https://developer.mozilla.org/docs/flatMap', title: '  Array.flatMap \n MDN ', project: ' Launch '}, now);
  assert.equal(created, true);
  assert.deepEqual(storage.data.schema, {version: 1}, 'the first save records the schema');
  assert.deepEqual(storage.data[`link:${link.id}`], {id: link.id, url: 'https://developer.mozilla.org/docs/flatMap', title: 'Array.flatMap MDN',
    project: 'Launch', favorite: false, savedAt: now, lastOpenedAt: null, openCount: 0, source: 'tab'});
  assert.equal(link.id, await linkId(link.url), 'the key is derived from the address');
  const edited = await updateLink(storage, link.id, {title: 'flatMap reference', project: '', favorite: true});
  assert.deepEqual([edited.title, edited.project, edited.favorite, edited.url, edited.savedAt], ['flatMap reference', '', true, link.url, now]);
  assert.deepEqual((await loadLinks(storage)).links, [edited]);
  await removeLink(storage, link.id);
  assert.deepEqual(linkKeys(storage), []);
  assert.deepEqual(storage.data, {gateway: 'http://127.0.0.1:4318/classify', 'rule:r1': rule, schema: {version: 1}});
  assert.deepEqual(await loadRules(storage), [rule], 'keep rules still load beside saved links');
  await assert.rejects(updateLink(storage, link.id, {title: 'x'}), /no longer saved/);
});

test('saving an address again keeps the existing favorite flag and project; other addresses stay separate', async () => {
  const storage = fakeStorage();
  const first = await saveLink(storage, {url: 'https://shop.example/item?id=1', title: 'Item 1', favorite: true, project: 'Desk'}, now);
  const writes = storage.writes;
  const again = await saveLink(storage, {url: 'HTTPS://SHOP.EXAMPLE:443/item?id=1', title: 'Renamed', favorite: false, project: ''}, now + 1);
  assert.equal(again.created, false);
  assert.deepEqual(again.link, first.link);
  assert.equal(storage.writes, writes, 'a duplicate save writes nothing');
  for (const url of ['https://shop.example/item?id=2', 'https://shop.example/item?id=1#reviews', 'https://shop.example/item?id=1#specs']) {
    assert.equal((await saveLink(storage, {url, title: url}, now)).created, true);
  }
  assert.equal((await loadLinks(storage)).links.length, 4);
});

test('simultaneous saves from two dashboards produce one record, and per-link writes never overwrite other links', async () => {
  // Hold every write until both dashboards have read, so each deterministically sees the address as unsaved.
  const storage = fakeStorage(), {get, set} = storage;
  let reads = 0, release;
  const bothRead = new Promise(resolve => { release = resolve; });
  storage.get = async keys => { const found = await get.call(storage, keys); if (++reads === 2) release(); return found; };
  storage.set = async items => { await bothRead; return set.call(storage, items); };
  const [a, b] = await Promise.all([
    saveLink(storage, {url: 'https://docs.example.dev/guide#install', title: 'From dashboard A'}, now),
    saveLink(storage, {url: 'HTTPS://DOCS.EXAMPLE.DEV:443/guide#install', title: 'From dashboard B'}, now + 1)
  ]);
  assert.deepEqual([a.created, b.created], [true, true], 'both dashboards saw no record and both wrote');
  assert.equal(a.link.id, b.link.id);
  assert.equal(linkKeys(storage).length, 1, 'the shared key leaves a single record');
  const other = await saveLink(storage, {url: 'https://calendar.example.com/week', title: 'Calendar'}, now);
  await Promise.all([
    updateLink(storage, a.link.id, {favorite: true}),
    saveLink(storage, {url: 'https://tracker.example.com/board', title: 'Tracker'}, now),
    recordOpen(storage, other.link.id, now + 5)
  ]);
  const {links} = await loadLinks(storage);
  assert.equal(links.length, 3);
  assert.equal(links.find(link => link.id === a.link.id).favorite, true);
  assert.equal(links.find(link => link.id === other.link.id).openCount, 1);
});

test('failed writes are reported and change nothing', async () => {
  const storage = fakeStorage({gateway: 'https://gateway.example/classify'});
  const {link} = await saveLink(storage, {url: 'https://example.org/keep', title: 'Keep'}, now);
  const before = structuredClone(storage.data);
  storage.fail = 'QUOTA_BYTES quota exceeded';
  await assert.rejects(saveLink(storage, {url: 'https://example.org/new', title: 'New'}, now), /QUOTA_BYTES/);
  await assert.rejects(updateLink(storage, link.id, {title: 'Changed'}), /QUOTA_BYTES/);
  await assert.rejects(removeLink(storage, link.id), /QUOTA_BYTES/);
  assert.deepEqual(storage.data, before);
  // A write that silently does not persist is not reported as saved.
  const lossy = {...fakeStorage(), async set() {}};
  await assert.rejects(saveLink(lossy, {url: 'https://example.org/lost'}, now), /could not be confirmed/);
});

test('a newer or unrecognized schema is shown read-only and never rewritten or migrated', async () => {
  const url = 'https://calendar.example.com/', id = await linkId(url);
  const future = {id, url, title: 'Calendar', project: '', favorite: true, savedAt: 1, lastOpenedAt: null, openCount: 2, source: 'tab', tags: ['v2']};
  for (const schema of [{version: 2}, {version: 'beta'}, null]) {
    const storage = fakeStorage({schema, [`link:${id}`]: future, 'rule:r1': rule});
    const before = structuredClone(storage.data);
    const state = await loadLinks(storage);
    assert.equal(state.readOnly, true);
    assert.deepEqual(state.links, [future], 'records are still listed');
    await assert.rejects(saveLink(storage, {url: 'https://example.org/new'}, now), /read-only/);
    await assert.rejects(updateLink(storage, id, {title: 'x'}), /read-only/);
    await assert.rejects(removeLink(storage, id), /read-only/);
    const tabs = fakeTabs(), reopened = await reopenLink(storage, tabs, future, 7, now);
    assert.deepEqual([reopened.opened, reopened.recorded, tabs.created.length], [true, false, 1], 'reopening works but use is not recorded');
    assert.match(reopened.error.message, /read-only/);
    assert.deepEqual(storage.data, before);
    assert.equal(storage.writes, 0);
  }
  await assert.rejects(saveLink(fakeStorage({schema: {version: 2}}), {url}, now), /newer version of Jev \(format 2\)/);
  await assert.rejects(saveLink(fakeStorage({schema: {version: 'beta'}}), {url}, now), /format this version does not recognize/);
});

test('malformed records are reported as unreadable and left untouched', async () => {
  const url = 'https://example.org/page', id = await linkId(url);
  const good = {id, url, title: 'Page', project: '', favorite: false, savedAt: 1, lastOpenedAt: null, openCount: 0, source: 'tab'};
  const evilId = await linkId('javascript:alert(1)');
  const storage = fakeStorage({
    'link:bogus': {id: 'bogus'},
    [`link:${id}`]: {...good, openCount: -1},
    [`link:${evilId}`]: {...good, id: evilId, url: 'javascript:alert(1)'},
    [`link:${'0'.repeat(64)}`]: {...good, id: '0'.repeat(64)},
    'link:text': 'not a record'
  });
  const before = structuredClone(storage.data), state = await loadLinks(storage);
  assert.deepEqual([state.links.length, state.unreadable.length, state.readOnly], [0, 5, false]);
  await assert.rejects(saveLink(storage, {url, title: 'Page'}, now), /could not be read/);
  await assert.rejects(updateLink(storage, id, {title: 'x'}), /could not be read/);
  assert.deepEqual(storage.data, before);
});

test('reopening records use only when the browser creates the tab', async () => {
  const storage = fakeStorage(), {link} = await saveLink(storage, {url: 'https://tracker.example.com/board?view=mine#today', title: 'Tracker'}, now);
  const tabs = fakeTabs(), opened = await reopenLink(storage, tabs, link, 7, now + 60000);
  assert.deepEqual([opened.opened, opened.recorded], [true, true]);
  assert.deepEqual(tabs.created, [{id: 500, url: link.url, windowId: 7, active: true}], 'the full address opens in the current window');
  assert.deepEqual(((await loadLinks(storage)).links[0]), {...link, openCount: 1, lastOpenedAt: now + 60000});
  const failed = await reopenLink(storage, fakeTabs('No window with id: 7.'), link, 7, now + 120000);
  assert.deepEqual([failed.opened, failed.recorded, failed.error.message], [false, false, 'No window with id: 7.']);
  assert.equal((await loadLinks(storage)).links[0].openCount, 1, 'a failed open is not counted');
  storage.fail = 'QUOTA_BYTES quota exceeded';
  const unrecorded = await reopenLink(storage, fakeTabs(), link, 7, now);
  assert.deepEqual([unrecorded.opened, unrecorded.recorded, unrecorded.error.message], [true, false, 'QUOTA_BYTES quota exceeded']);
  storage.fail = null;
  await removeLink(storage, link.id);
  const removed = await reopenLink(storage, fakeTabs(), link, 7, now);
  assert.deepEqual([removed.opened, removed.recorded], [true, false], 'a link removed elsewhere still opens but is not recreated');
  assert.deepEqual(linkKeys(storage), []);
});

test('favorites are ordered by use and references are grouped by project', () => {
  const link = (url, patch) => ({id: url, url: `https://${url}/`, title: url, project: '', favorite: false, savedAt: 1, lastOpenedAt: null, openCount: 0, source: 'tab', ...patch});
  const {favorites, later} = arrange([
    link('calendar.example.com', {favorite: true, openCount: 2, lastOpenedAt: 5}),
    link('tracker.example.com', {favorite: true, openCount: 9}),
    link('staging.example.com', {favorite: true, openCount: 2, lastOpenedAt: 8}),
    link('mdn.example.org', {savedAt: 3, project: 'Launch'}),
    link('blog.example.org', {savedAt: 4}),
    link('spec.example.org', {savedAt: 5, project: 'Launch'}),
    link('api.example.org', {savedAt: 2, project: 'Billing'})
  ]);
  assert.deepEqual(favorites.map(item => item.title), ['tracker.example.com', 'staging.example.com', 'calendar.example.com']);
  assert.deepEqual(later.map(([project, items]) => [project, items.map(item => item.title)]),
    [['Billing', ['api.example.org']], ['Launch', ['spec.example.org', 'mdn.example.org']], ['', ['blog.example.org']]]);
});

test('export serializes every saved record and parses back unchanged', async () => {
  const storage = fakeStorage({'rule:r1': rule, 'link:bogus': {id: 'bogus'}});
  await saveLink(storage, {url: 'https://calendar.example.com/week', title: 'Calendar', favorite: true}, now);
  await saveLink(storage, {url: 'https://docs.example.dev/guide?lang=en#install', title: 'Guide “install”', project: 'Launch'}, now + 1);
  const state = await loadLinks(storage), text = serializeExport(state, now + 2);
  assert.deepEqual(parseExport(text), {schemaVersion: 1, exportedAt: '2026-09-26T12:00:00.002Z', links: state.links, unreadable: [{key: 'link:bogus', value: {id: 'bogus'}}]});
  assert.equal(JSON.parse(text).links[1].url, 'https://docs.example.dev/guide?lang=en#install', 'full addresses are exported');
  assert.doesNotMatch(text, /jira\.example\.com/, 'keep rules are not part of the export');
  assert.throws(() => parseExport('{}'), /not a Jev saved-links export/);
  assert.throws(() => parseExport(text.replace('https://calendar.example.com/week', 'javascript:alert(1)')), /invalid saved link/);
  assert.throws(() => parseExport('not json'));
});
