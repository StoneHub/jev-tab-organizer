export const CATEGORIES = Object.freeze({
  build: {title: 'Build & code', color: 'blue', description: 'Software development, source code, APIs and technical documentation'},
  learn: {title: 'Read & learn', color: 'purple', description: 'Reference, research, education and reading'},
  work: {title: 'Work & connect', color: 'cyan', description: 'Email, meetings, collaboration and productivity'},
  shop: {title: 'Shop & compare', color: 'orange', description: 'Shopping, products and purchase comparisons'},
  watch: {title: 'Watch & play', color: 'pink', description: 'Video, music, entertainment and games'},
  other: {title: 'Everything else', color: 'grey', description: 'No clear match, ambiguous or insufficient evidence'}
});
const rules = [
  ['build', /github|gitlab|stackoverflow|developer|\bapi\b|\bdocs\b|localhost|typescript|javascript|\bcode\b/i],
  ['work', /gmail|outlook|slack|notion|calendar|meet\.google|\bmeeting\b|\bemail\b/i],
  ['shop', /amazon|ebay|etsy|shop|\bcart\b|\bbuy\b|\bprice\b/i],
  ['watch', /youtube|netflix|spotify|twitch|\bvideo\b|\bmusic\b|\bgame\b/i],
  ['learn', /wikipedia|arxiv|\bresearch\b|\blearn\b|\btutorial\b|\bnews\b|\barticle\b/i]
];
export function eligible(tab) {
  return Number.isInteger(tab.id) && !tab.pinned && !tab.incognito && tab.groupId === -1 && /^https?:\/\//i.test(tab.url || '');
}
export function metadata(tab) {
  return {id: tab.id, title: String(tab.title || '').slice(0, 240), domain: new URL(tab.url).hostname};
}
export function localCategory(tab) {
  const data = metadata(tab);
  return rules.find(([, pattern]) => pattern.test(`${data.domain} ${data.title}`))?.[0] || 'other';
}
export function gatewayUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Use HTTPS, or HTTP on localhost. No credentials, query strings or fragments.');
  }
  return url;
}
export function validateAssignments(data, ids) {
  if (data?.version !== 1 || !Array.isArray(data.assignments) || data.assignments.length !== ids.length) throw new Error('Invalid gateway response');
  const allowed = new Set(ids), seen = new Set();
  for (const item of data.assignments) {
    if (!allowed.has(item.id) || seen.has(item.id) || !Object.hasOwn(CATEGORIES, item.category) ||
      typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      throw new Error('Invalid gateway assignment');
    }
    seen.add(item.id);
  }
  return data.assignments;
}
export function applySuggestions(tabs, assignments) {
  const suggestions = new Map(assignments.map(item => [item.id, item]));
  return tabs.map(tab => {
    const match = suggestions.get(tab.id);
    return {...tab, category: match?.confidence >= 0.65 ? match.category : localCategory(tab),
      source: match?.confidence >= 0.65 ? 'Jev' : 'Local', confidence: match?.confidence};
  });
}
