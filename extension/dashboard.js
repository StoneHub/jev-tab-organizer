import {CATEGORIES, eligible, metadata, localCategory, gatewayUrl, validateAssignments, applySuggestions} from './core.js';
import {triage} from './triage.js';
import {loadRules, keepSite, setRetired, removeRule, clearRules, isRuleKey} from './rules.js';
import {normalizeUrl, loadLinks, saveLink, updateLink, removeLink, reopenLink, arrange, serializeExport, readOnlyReason, isLinkKey} from './saved.js';
const $ = id => document.getElementById(id);
let tabs = [], selected = new Set(), windowId, busy = false;
// Tidy view state: the view shown, keep rules, the user's per-tab decision changes, and tabs left alone.
let view = 'topic', rules = [], overrides = new Map(), leftAlone = 0;
// Saved view state: stored links, this window's web tabs that can be saved, and the link being edited with its unsaved draft.
let saved = {links: [], unreadable: [], readOnly: false}, savedError = '', webTabs = [], editing = null, linkLoads = 0;
const DECISIONS = {close: 'Close', save: 'Save and close', keep: 'Keep open'};
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
  if (view === 'tidy') renderTidy();
  if (view === 'saved') renderSaved();
  controls(busy);
}
const button = (label, onClick) => { const element = document.createElement('button'); element.textContent = label; element.addEventListener('click', onClick); return element; };
// The Tidy preview only suggests: it never closes, saves or moves a tab. Changing a decision is remembered until the next refresh.
function renderTidy() {
  const suggestions = triage(tabs, {rules});
  $('tidy-left-alone').textContent = `Left alone: ${leftAlone} pinned, private, grouped or non-web tab${leftAlone === 1 ? '' : 's'}. Suggestions only; nothing is closed or saved in this version.`;
  $('tidy-sections').replaceChildren();
  for (const [decision, heading] of Object.entries(DECISIONS)) {
    const rows = suggestions.filter(suggestion => (overrides.get(suggestion.id) ?? suggestion.decision) === decision);
    const section = document.createElement(decision === 'keep' ? 'details' : 'article'); section.className = 'group';
    const title = document.createElement(decision === 'keep' ? 'summary' : 'h2'); title.textContent = `${heading} (${rows.length})`; section.append(title);
    for (const suggestion of rows) section.append(tidyRow(tabs.find(tab => tab.id === suggestion.id), suggestion));
    $('tidy-sections').append(section);
  }
  renderRules();
}
function tidyRow(tab, suggestion) {
  const row = document.createElement('div'); row.className = 'tab tidy-row';
  const title = document.createElement('span'), domain = document.createElement('span'), select = document.createElement('select');
  title.className = 'title'; title.textContent = tab.title || '(Untitled tab)'; title.title = tab.title;
  const override = overrides.get(tab.id);
  domain.className = 'domain reason'; domain.textContent = `${metadata(tab).domain} · ${override ? `You chose this (suggested: ${suggestion.reason})` : suggestion.reason}`;
  select.setAttribute('aria-label', `Decision for ${tab.title}`);
  for (const [value, label] of Object.entries(DECISIONS)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
  select.value = override ?? suggestion.decision;
  select.addEventListener('change', () => { select.value === suggestion.decision ? overrides.delete(tab.id) : overrides.set(tab.id, select.value); renderTidy(); });
  const keep = suggestion.signal === 'rule' ? Object.assign(document.createElement('span'), {className: 'domain', textContent: 'Kept by your rule'})
    : button('Always keep this site', async () => { const rule = await keepSite(chrome.storage.local, tab.url); await reloadRules(); status(`Tabs on ${rule.host} will always be kept.`); });
  row.append(title, domain, select, keep);
  return row;
}
function renderRules() {
  $('rules').replaceChildren();
  for (const rule of rules) {
    const item = document.createElement('li'), label = document.createElement('span');
    label.textContent = `${rule.host}${rule.pathPrefix === '/' ? '' : rule.pathPrefix}${rule.retired ? ' (retired)' : ''}`;
    item.append(label,
      button(rule.retired ? 'Restore' : 'Retire', async () => { await setRetired(chrome.storage.local, rule, !rule.retired); await reloadRules(); }),
      button('Remove', async () => { await removeRule(chrome.storage.local, rule.id); await reloadRules(); }));
    $('rules').append(item);
  }
  if (!rules.length) { const empty = document.createElement('li'); empty.className = 'fine'; empty.textContent = 'No rules yet. Use "Always keep this site" on a tab.'; $('rules').append(empty); }
  $('clear-rules').disabled = !rules.length;
}
async function reloadRules() { rules = await loadRules(chrome.storage.local); if (view === 'tidy') renderTidy(); }
// The Saved view changes storage only: saving, editing and removing never close, group or move a tab.
const label = link => link.title || link.url;
const text = (tag, className, content) => Object.assign(document.createElement(tag), {className, textContent: content});
const address = url => { const element = text('span', 'domain url', url); element.title = url; return element; };
function renderSaved() {
  if (editing && !saved.links.some(link => link.id === editing.id)) editing = null;
  const notes = [], unreadable = saved.unreadable.length, urls = new Set(saved.links.map(link => link.url));
  if (savedError) notes.push(`Could not read saved links (${savedError}). Reload the organizer to try again.`);
  if (saved.readOnly) notes.push(readOnlyReason(saved));
  if (unreadable) notes.push(`${unreadable} saved record${unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'was' : 'were'} left untouched. Export includes ${unreadable === 1 ? 'it' : 'them'}.`);
  $('saved-notes').replaceChildren(...notes.map(note => text('p', 'fine warning', note)));
  $('save-favorite').disabled = $('save-project').disabled = saved.readOnly;
  $('save-candidates').replaceChildren(...webTabs.map(tab => {
    const row = text('div', 'tab saved-row', ''); let url; try { url = normalizeUrl(tab.url); } catch { url = tab.url; }
    const action = urls.has(url) ? text('span', 'domain', 'Saved') : button('Save', () => save(tab)); action.disabled = saved.readOnly;
    row.append(text('span', 'title', tab.title || '(Untitled tab)'), address(tab.url), action);
    return row;
  }));
  if (!webTabs.length) $('save-candidates').append(text('p', 'fine pad', 'No web tabs in this window. Open a page, then refresh.'));
  const {favorites, later} = arrange(saved.links), quick = text('article', 'group', ''), forLater = text('article', 'group', '');
  quick.append(text('h2', '', `Quick return ★ (${favorites.length})`), ...favorites.map(savedRow));
  if (!favorites.length) quick.append(text('p', 'fine pad', 'No Quick return links yet. Tick Quick return when saving, or edit a saved link.'));
  forLater.append(text('h2', '', `Saved for later (${saved.links.length - favorites.length})`));
  for (const [project, links] of later) forLater.append(text('h3', '', project || 'No project'), ...links.map(savedRow));
  if (!later.length) forLater.append(text('p', 'fine pad', 'Nothing saved for later. Save a tab above; it stays open.'));
  $('saved-lists').replaceChildren(quick, forLater);
  $('saved-projects').replaceChildren(...[...new Set(saved.links.map(link => link.project).filter(Boolean))].sort().map(value => Object.assign(document.createElement('option'), {value})));
  $('export-saved').disabled = Boolean(savedError) || (!saved.links.length && !unreadable);
}
function savedRow(link) {
  if (editing?.id === link.id) return editRow(link);
  const row = text('div', 'tab saved-row', ''), actions = text('div', 'row-actions', '');
  const details = [link.favorite ? '★ Quick return' : 'Saved for later', link.project, `saved ${new Date(link.savedAt).toLocaleDateString()}`,
    link.openCount ? `opened ${link.openCount} time${link.openCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const changes = [button('Edit', () => { editing = {id: link.id, title: link.title, project: link.project, favorite: link.favorite}; renderSaved(); }),
    button('Remove', () => forget(link))];
  for (const change of changes) change.disabled = saved.readOnly;
  actions.append(button('Open', () => reopen(link)), ...changes);
  row.append(text('span', 'title', label(link)), text('span', 'domain', details), address(link.url), actions);
  return row;
}
function editRow(link) {
  const row = text('div', 'tab saved-row', ''), actions = text('div', 'row-actions', ''), favorite = text('label', 'consent', ' Quick return');
  const field = (name, caption, max) => {
    const wrap = text('label', 'field', caption), input = Object.assign(document.createElement('input'), {type: 'text', value: editing[name], maxLength: max});
    input.addEventListener('input', () => { editing[name] = input.value; }); wrap.append(input); return wrap;
  };
  const project = field('project', 'Project', 80); project.lastChild.setAttribute('list', 'saved-projects');
  const check = Object.assign(document.createElement('input'), {type: 'checkbox', checked: editing.favorite});
  check.addEventListener('change', () => { editing.favorite = check.checked; }); favorite.prepend(check);
  actions.append(button('Save changes', commitEdit), button('Cancel', () => { editing = null; renderSaved(); }));
  row.append(field('title', 'Title', 500), address(link.url), project, favorite, actions);
  return row;
}
// Reloads can overlap (this dashboard's own write and another dashboard's change); only the latest one is shown.
async function reloadLinks() {
  const load = ++linkLoads;
  try { const next = await loadLinks(chrome.storage.local); if (load !== linkLoads) return; saved = next; savedError = ''; }
  catch (error) { if (load !== linkLoads) return; savedError = error.message; }
  if (view === 'saved') renderSaved();
}
async function save(tab) {
  try {
    const {link, created} = await saveLink(chrome.storage.local, {url: tab.url, title: tab.title, favorite: $('save-favorite').checked, project: $('save-project').value});
    status(created ? `Saved “${label(link)}” to ${link.favorite ? 'Quick return' : 'Saved for later'}. The tab stays open.`
      : `“${label(link)}” is already saved${link.favorite ? ' in Quick return' : ''}; nothing changed. Use Edit to change it.`);
  } catch (error) { status(`Could not save “${tab.title || tab.url}”: ${error.message}`); }
  await reloadLinks();
}
async function commitEdit() {
  const draft = editing; if (!draft) return;
  try { const link = await updateLink(chrome.storage.local, draft.id, draft); editing = null; status(`Updated “${label(link)}”.`); }
  catch (error) { status(`Could not update this link: ${error.message}`); }
  await reloadLinks();
}
async function forget(link) {
  try { await removeLink(chrome.storage.local, link.id); status(`Removed “${label(link)}” from saved links. Open tabs are unchanged.`); }
  catch (error) { status(`Could not remove “${label(link)}”: ${error.message}`); }
  await reloadLinks();
}
// A new tab only proves the browser accepted the address, not that the page loaded, so the message says no more than that.
async function reopen(link) {
  const result = await reopenLink(chrome.storage.local, chrome.tabs, link, windowId);
  status(result.opened ? `Opened a new tab for “${label(link)}”.${result.recorded ? '' : ` Its use was not recorded: ${result.error.message}`}`
    : `Could not open “${label(link)}”: ${result.error.message}`);
  await reloadLinks();
}
function exportSaved() {
  const name = `jev-saved-links-${new Date().toISOString().slice(0, 10)}.json`, count = saved.links.length;
  const url = URL.createObjectURL(new Blob([serializeExport(saved)], {type: 'application/json'}));
  Object.assign(document.createElement('a'), {href: url, download: name}).click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  status(`Exported ${count} saved link${count === 1 ? '' : 's'}${saved.unreadable.length ? ` and ${saved.unreadable.length} unreadable record${saved.unreadable.length === 1 ? '' : 's'}` : ''} as ${name}. Check your downloads.`);
}
function show(next) {
  view = next;
  for (const name of ['topic', 'tidy', 'saved']) $(`view-${name}`).setAttribute('aria-pressed', String(view === name));
  $('groups').hidden = view !== 'topic'; $('apply').hidden = view !== 'topic'; $('tidy').hidden = view !== 'tidy'; $('saved').hidden = view !== 'saved';
  if (view === 'tidy') { renderTidy(); status('Tidy preview. Suggestions only: nothing is closed or saved in this version.'); }
  else if (view === 'saved') { renderSaved(); status('Saved links. Saving keeps the tab open, and links stay on this device.'); }
  else status('Local preview ready. Adjust any group, then create groups.');
}
async function refresh() {
  const all = await chrome.tabs.query({windowId}), own = chrome.runtime.getURL('');
  tabs = all.filter(eligible).map(tab => ({...tab, category:localCategory(tab), source:'Local'}));
  webTabs = all.filter(tab => !tab.incognito && /^https?:\/\//i.test(tab.url || '')); // pinned and grouped tabs can be saved too; saving never changes them
  leftAlone = all.filter(tab => !eligible(tab) && !(tab.url || '').startsWith(own)).length; overrides.clear();
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
$('view-topic').addEventListener('click', () => show('topic')); $('view-tidy').addEventListener('click', () => show('tidy'));
$('view-saved').addEventListener('click', () => show('saved')); $('export-saved').addEventListener('click', exportSaved);
$('clear-rules').addEventListener('click', async () => { await clearRules(chrome.storage.local); await reloadRules(); status('Keep rules cleared.'); });
// Another open dashboard may add or remove rules and saved links.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(isRuleKey)) void reloadRules();
  if (Object.keys(changes).some(key => isLinkKey(key) || key === 'schema')) void reloadLinks();
});
try { windowId = (await chrome.windows.getCurrent()).id; rules = await loadRules(chrome.storage.local); await reloadLinks(); const prefs = await chrome.storage.local.get('gateway'); $('gateway').value = prefs.gateway || ''; await refresh(); status('Local preview ready. Adjust any group, then create groups.'); } catch { status('Unable to load tabs. Open this page through the extension toolbar button.'); }
