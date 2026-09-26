// Optional browser acceptance: npm install --no-save playwright; npx playwright install chromium
import {mkdtemp, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseExport} from '../extension/saved.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const profile = await mkdtemp(path.join(tmpdir(),'jev-tabs-smoke-'));
const extension = path.resolve('extension');
// Launching the same profile again is a browser restart; every https request is answered by a local fixture.
const launch = async () => {
  const launched = await chromium.launchPersistentContext(profile, {channel:'chromium', headless:true, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await launched.route(/^https:\/\//, route => route.fulfill({body:'<!doctype html><title>Fixture</title><h1>Fixture only; no external request</h1>',contentType:'text/html'}));
  return launched;
};
let context = await launch();
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const urls = ['https://github.com/fixture','https://docs.example.com/fixture','https://wikipedia.org/fixture','https://youtube.com/fixture','https://amazon.com/fixture','https://example.org/pinned','https://example.org/grouped'];
  for (const url of urls) { const fixture = await context.newPage(); await fixture.goto(url); }
  const setup = await worker.evaluate(async urls => {
    const all = await chrome.tabs.query({});
    const tabs = urls.map(url => all.find(tab => tab.url === url));
    await chrome.tabs.update(tabs[5].id,{pinned:true});
    const group = await chrome.tabs.group({tabIds:[tabs[6].id]}); await chrome.tabGroups.update(group,{title:'Keep me',color:'green'});
    return {ids:tabs.map(tab => tab.id),group};
  }, urls);
  const page = await context.newPage();
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await page.waitForFunction(() => document.getElementById('count').textContent.startsWith('5 selected'));
  await page.locator('#apply').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Grouped 5 tabs.'));
  const after = await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id))),setup.ids);
  assert.equal(after[0].groupId,after[1].groupId);
  assert.ok(after.slice(0,5).every(tab => tab.groupId !== -1));
  assert.equal(after[5].pinned,true); assert.equal(after[5].groupId,-1);
  assert.equal(after[6].groupId,setup.group);
  await page.locator('#undo').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Last batch ungrouped.'));
  const undone = await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id))),setup.ids);
  assert.ok(undone.slice(0,5).every(tab => tab.groupId === -1)); assert.equal(undone[6].groupId,setup.group);
  // Navigate after preview: changed URL must not be grouped using an old classification.
  await worker.evaluate(id => chrome.tabs.update(id,{url:'https://example.net/changed'}),setup.ids[0]);
  await page.locator('#apply').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Skipped 1 changed tabs'));
  assert.equal((await worker.evaluate(id => chrome.tabs.get(id),setup.ids[0])).groupId,-1);
  await page.locator('#undo').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Last batch ungrouped.'));
  // Tidy preview: every tab gets a reason, a keep rule survives a reload, and the preview changes no tab.
  const snapshot = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => [tab.id,tab.url,tab.groupId,tab.pinned,tab.index].join('|')).sort());
  const before = await snapshot();
  await page.locator('#view-tidy').click();
  await page.waitForFunction(() => document.querySelectorAll('#tidy .tidy-row').length === 5);
  assert.ok((await page.locator('#tidy .reason').allTextContents()).every(text => / · \S/.test(text)));
  assert.match(await page.locator('#tidy-left-alone').textContent(), /^Left alone: \d+ /);
  await page.locator('#tidy details summary').click();
  await page.locator('#tidy .tidy-row',{hasText:'docs.example.com'}).getByRole('button',{name:'Always keep this site'}).click();
  await page.waitForFunction(() => document.getElementById('rules').textContent.includes('docs.example.com'));
  await page.reload();
  await page.locator('#view-tidy').click();
  await page.waitForFunction(() => document.getElementById('rules').textContent.includes('docs.example.com'));
  assert.match(await page.locator('#tidy .tidy-row',{hasText:'docs.example.com'}).locator('.reason').textContent(), /Your rule: always keep docs\.example\.com/);
  await page.getByRole('button',{name:'Clear all rules'}).click();
  await page.waitForFunction(() => document.getElementById('rules').textContent.includes('No rules yet'));
  assert.deepEqual(await snapshot(), before);
  await page.locator('#view-topic').click();
  await mkdir('dist',{recursive:true}); await page.screenshot({path:'dist/browser-smoke.png',fullPage:true});
  // Saved links (#3): saving changes no tab, a second dashboard follows storage changes, and reopening adds one tab in this window.
  // Reopen checks use a loopback address that fails locally: extension-created tabs bypass the fixture route, and an address that no
  // longer works must still open without the dashboard claiming the page loaded.
  const loopback = 'http://127.0.0.1:9/saved-fixture?view=mine#today';
  const until = (target, predicate, arg) => target.waitForFunction(predicate, arg, {polling:100});
  const savedRows = target => target.locator('#saved-lists .saved-row');
  const newTabs = async (target, known) => (await target.evaluate(async known => (await chrome.tabs.query({})).filter(tab => !known.includes(tab.id))
    .map(tab => [tab.pendingUrl || tab.url, tab.windowId]), known));
  const tabIds = target => target.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
  const record = async (target, url) => Object.values(await target.evaluate(() => chrome.storage.local.get(null))).find(value => value?.url === url);
  await worker.evaluate(url => chrome.tabs.create({url, active:false}), loopback);
  const other = await context.newPage(); other.on('pageerror',error => errors.push(error.message));
  await other.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await other.locator('#view-saved').click();
  await page.bringToFront(); await page.locator('#refresh').click(); await page.locator('#view-saved').click();
  const beforeSaving = await snapshot();
  const saveTab = async url => {
    const row = page.locator('#save-candidates .saved-row',{hasText:url});
    await row.getByRole('button',{name:'Save'}).click(); await row.getByText('Saved',{exact:true}).waitFor();
  };
  await page.locator('#save-project').fill('Fixture research'); await saveTab('https://docs.example.com/fixture');
  await page.locator('#save-project').fill(''); await page.locator('#save-favorite').check();
  await saveTab('https://example.org/pinned'); await saveTab(loopback);
  await page.locator('#save-favorite').uncheck(); await saveTab('https://wikipedia.org/fixture');
  await until(other, () => document.querySelectorAll('#saved-lists .saved-row').length === 4);
  assert.deepEqual(await snapshot(), beforeSaving, 'saving closes, groups and moves nothing');
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(stored.schema,{version:1});
  assert.deepEqual(Object.entries(stored).filter(([key]) => key.startsWith('link:')).map(([, link]) => [link.url,link.favorite,link.project]).sort(),
    [[loopback,true,''],['https://docs.example.com/fixture',false,'Fixture research'],['https://example.org/pinned',true,''],['https://wikipedia.org/fixture',false,'']]);
  await other.bringToFront();
  const docs = savedRows(other).filter({hasText:'docs.example.com/fixture'});
  await docs.getByRole('button',{name:'Edit'}).click();
  await docs.getByLabel('Title').fill('Docs fixture'); await docs.getByLabel('Quick return').check();
  await docs.getByRole('button',{name:'Save changes'}).click();
  await until(page, () => document.getElementById('saved-lists').textContent.includes('Quick return ★ (3)'));
  await page.bringToFront();
  await savedRows(page).filter({hasText:'wikipedia.org/fixture'}).getByRole('button',{name:'Remove'}).click();
  await until(page, () => document.querySelectorAll('#saved-lists .saved-row').length === 3);
  await until(other, () => document.querySelectorAll('#saved-lists .saved-row').length === 3);
  assert.deepEqual(await snapshot(), beforeSaving, 'editing and removing saved links leaves every tab as it was');
  const known = await tabIds(page), dashboardWindow = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await savedRows(page).filter({hasText:'127.0.0.1:9/saved-fixture'}).getByRole('button',{name:'Open'}).click();
  await until(page, () => document.getElementById('status').textContent.startsWith('Opened a new tab for'));
  assert.deepEqual(await newTabs(page, known), [[loopback,dashboardWindow]], 'one new tab with the full address, in the dashboard window');
  const afterOpen = await snapshot();
  assert.ok(beforeSaving.every(entry => afterOpen.includes(entry)), 'reopening leaves existing tabs as they were');
  assert.equal((await record(page, loopback)).openCount, 1);
  const docsRecord = await record(page, 'https://docs.example.com/fixture');
  assert.deepEqual([docsRecord.title,docsRecord.favorite,docsRecord.project], ['Docs fixture',true,'Fixture research']);
  await page.bringToFront();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-saved').click()]);
  assert.match(download.suggestedFilename(), /^jev-saved-links-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(parseExport(await readFile(await download.path(),'utf8')).links.map(link => link.url).sort(),
    [loopback,'https://docs.example.com/fixture','https://example.org/pinned']);
  await page.screenshot({path:'dist/browser-smoke-saved.png',fullPage:true});
  // Restart the same isolated profile: saved links persist, and a favorite reopens in the new session's window.
  await context.close();
  context = await launch();
  const restarted = await context.newPage(); restarted.on('pageerror',error => errors.push(error.message));
  await restarted.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await restarted.locator('#view-saved').click();
  await until(restarted, () => document.querySelectorAll('#saved-lists .saved-row').length === 3);
  assert.match(await savedRows(restarted).filter({hasText:'127.0.0.1:9/saved-fixture'}).textContent(), /opened 1 time/);
  assert.match(await savedRows(restarted).filter({hasText:'docs.example.com/fixture'}).textContent(), /Docs fixture.*Fixture research/);
  const beforeRestartOpen = await tabIds(restarted), restartWindow = await restarted.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await savedRows(restarted).filter({hasText:'127.0.0.1:9/saved-fixture'}).getByRole('button',{name:'Open'}).click();
  await until(restarted, () => document.getElementById('status').textContent.startsWith('Opened a new tab for'));
  assert.deepEqual(await newTabs(restarted, beforeRestartOpen), [[loopback,restartWindow]]);
  assert.equal((await record(restarted, loopback)).openCount, 2);
  assert.deepEqual(errors,[]);
  console.log('PASS: real MV3 load, five-tab grouping, protected tabs/groups, session ungroup, stale navigation skip, Tidy preview with reasons and a persisted keep rule and no tab changes, zero dashboard errors.');
  console.log('PASS: saved links: save/edit/remove change no tab, a second dashboard follows storage changes, reopen adds one tab in the dashboard window and records use, JSON export parses, links persist across a browser restart of the isolated profile.');
  console.log(`Temporary isolated browser profile: ${profile}`);
} finally { await context.close(); }
