// Optional browser acceptance: npm install --no-save playwright; npx playwright install chromium
import {mkdtemp, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const profile = await mkdtemp(path.join(tmpdir(),'jev-tabs-smoke-'));
const extension = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {channel:'chromium', headless:true, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  await context.route(/^https:\/\//, route => route.fulfill({body:'<!doctype html><title>Fixture</title><h1>Fixture only; no external request</h1>',contentType:'text/html'}));
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
  assert.deepEqual(errors,[]);
  console.log('PASS: real MV3 load, five-tab grouping, protected tabs/groups, session ungroup, stale navigation skip, Tidy preview with reasons and a persisted keep rule and no tab changes, zero dashboard errors.');
  console.log(`Temporary isolated browser profile: ${profile}`);
} finally { await context.close(); }
