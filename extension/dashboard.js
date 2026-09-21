import {CATEGORIES, eligible, metadata, localCategory, gatewayUrl, validateAssignments, applySuggestions} from './core.js';
const $ = id => document.getElementById(id);
let tabs = [], selected = new Set(), windowId, busy = false;
const colors = {blue:'#79aaff',purple:'#c499fa',cyan:'#77d7e9',orange:'#f3b779',pink:'#f59bcb',grey:'#aab3c0'};
function status(message) { $('status').textContent = message; }
function controls(value) {
  busy = value;
  for (const id of ['refresh','suggest','apply','undo']) $(id).disabled = value;
  $('apply').disabled = value || selected.size === 0;
  if (!value) chrome.storage.session.get('lastBatch').then(({lastBatch}) => { if (!busy) $('undo').disabled = !lastBatch?.length; });
  document.querySelectorAll('#groups input,#groups select').forEach(input => { input.disabled = value; });
}
function render() {
  $('groups').replaceChildren();
  $('count').textContent = `${selected.size} selected / ${tabs.length} available tabs`;
  for (const [key, category] of Object.entries(CATEGORIES)) {
    const members = tabs.filter(tab => tab.category === key);
    if (!members.length) continue;
    const section = document.createElement('article'); section.className = 'group';
    const heading = document.createElement('h2'), dot = document.createElement('span'), count = document.createElement('span');
    dot.className = 'dot'; dot.style.setProperty('--accent', colors[category.color]);
    count.className = 'number'; count.textContent = members.length;
    heading.append(dot, document.createTextNode(category.title), count); section.append(heading);
    for (const tab of members) {
      const row = document.createElement('div'); row.className = 'tab';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(tab.id); check.setAttribute('aria-label', `Include ${tab.title}`);
      check.addEventListener('change', () => { check.checked ? selected.add(tab.id) : selected.delete(tab.id); $('consent').checked = false; render(); });
      const content = document.createElement('div'), title = document.createElement('span'), domain = document.createElement('span'), select = document.createElement('select');
      title.className = 'title'; title.textContent = tab.title || '(Untitled tab)'; title.title = tab.title;
      domain.className = 'domain'; domain.textContent = `${metadata(tab).domain} · ${tab.source}`;
      select.setAttribute('aria-label', `Group for ${tab.title}`);
      for (const [value, item] of Object.entries(CATEGORIES)) { const option = document.createElement('option'); option.value = value; option.textContent = item.title; select.append(option); }
      select.value = tab.category; select.addEventListener('change', () => { tab.category = select.value; tab.source = 'You'; render(); });
      content.append(title, domain, select); row.append(check, content); section.append(row);
    }
    $('groups').append(section);
  }
  if (!tabs.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'All clear. Open some ungrouped web tabs in this window, then refresh.'; $('groups').append(empty); }
  controls(busy);
}
async function refresh() {
  tabs = (await chrome.tabs.query({windowId})).filter(eligible).map(tab => ({...tab, category:localCategory(tab), source:'Local'}));
  selected = new Set(tabs.map(tab => tab.id)); $('consent').checked = false; render();
}
async function apply() {
  controls(true); let changed = 0, skipped = 0; const batch = [];
  try {
    for (const [category, spec] of Object.entries(CATEGORIES)) {
      const candidates = tabs.filter(tab => selected.has(tab.id) && tab.category === category), valid = [];
      for (const candidate of candidates) {
        const live = await chrome.tabs.get(candidate.id).catch(() => null);
        if (live && eligible(live) && live.windowId === windowId && live.url === candidate.url && live.title === candidate.title) valid.push(live.id); else skipped++;
      }
      if (!valid.length) continue;
      const groupId = await chrome.tabs.group({tabIds:valid});
      batch.push({groupId, tabIds:valid});
      await chrome.storage.session.set({lastBatch:batch});
      changed += valid.length;
      await chrome.tabGroups.update(groupId, {title:spec.title, color:spec.color, collapsed:false});
    }
    await refresh(); status(`Grouped ${changed} tabs.${skipped ? ` Skipped ${skipped} changed tabs; refresh to review them.` : ''} Use “Ungroup last batch” to remove these groups.`);
  } catch { status(`Stopped after grouping ${changed} tabs. Some tabs changed while organizing. Refresh before retrying; the last batch can be ungrouped.`); }
  finally { controls(false); }
}
async function suggest() {
  if (!$('consent').checked || !selected.size) return status('Check the sharing consent box for this selection first.');
  let url; try { url = gatewayUrl($('gateway').value.trim()); } catch (error) { return status(error.message); }
  // Permission request occurs directly in the click gesture; nothing is sent yet.
  const permission = chrome.permissions.request({origins:[`${url.origin}/*`]});
  controls(true);
  try {
    if (!await permission) throw new Error('Permission declined');
    await chrome.storage.local.set({gateway:url.href});
    const chosen = tabs.filter(tab => selected.has(tab.id));
    if (chosen.length > 100) throw new Error('Select at most 100 tabs');
    status(`Asking your gateway about ${chosen.length} selected tabs…`);
    const response = await fetch(url.href, {method:'POST', credentials:'omit', redirect:'error', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:1,tabs:chosen.map(metadata)}), signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Gateway unavailable');
    const raw = await response.text(); if (raw.length > 100000) throw new Error('Response too large');
    const assignments = validateAssignments(JSON.parse(raw), chosen.map(tab => tab.id));
    const enriched = new Map(applySuggestions(chosen, assignments).map(tab => [tab.id,tab]));
    tabs = tabs.map(tab => enriched.get(tab.id) || tab); render();
    status('Jev suggestions ready. Low-confidence choices use local sorting. Review before creating groups.');
  } catch (error) { status(`No Jev suggestions applied (${error.message}). Your existing local preview is still ready.`); }
  finally { $('consent').checked = false; controls(false); }
}
async function undo() {
  controls(true);
  try {
    const {lastBatch = []} = await chrome.storage.session.get('lastBatch');
    for (const batch of lastBatch) {
      const live = await Promise.all(batch.tabIds.map(id => chrome.tabs.get(id).catch(() => null)));
      const ids = live.filter(tab => tab?.groupId === batch.groupId).map(tab => tab.id);
      if (ids.length) await chrome.tabs.ungroup(ids);
    }
    await chrome.storage.session.remove('lastBatch'); await refresh();
    status('Last batch ungrouped. Tab order is not restored.');
  } catch { status('Some tabs changed. Refresh and try ungrouping again.'); }
  finally { controls(false); }
}
$('refresh').addEventListener('click', async () => { controls(true); try { await refresh(); status('Fresh local preview. Nothing has moved.'); } catch { status('Could not read tabs. Reload the organizer.'); } finally { controls(false); } });
$('apply').addEventListener('click', apply); $('suggest').addEventListener('click', suggest); $('undo').addEventListener('click', undo);
try { windowId = (await chrome.windows.getCurrent()).id; const prefs = await chrome.storage.local.get('gateway'); $('gateway').value = prefs.gateway || ''; await refresh(); status('Local preview ready. Adjust any group, then create groups.'); } catch { status('Unable to load tabs. Open this page through the extension toolbar button.'); }
