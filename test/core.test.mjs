import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible, metadata, localCategory, validateAssignments, applySuggestions, gatewayUrl} from '../extension/core.js';
import {validateInput, buildRequest, normalizeResponse, classify} from '../server/jev.mjs';
const tab = {id:7,url:'https://github.com/private/repo?token=secret#anchor',title:'A project',groupId:-1,pinned:false,incognito:false};
test('only normal ungrouped unpinned web tabs are eligible', () => {
  assert.equal(eligible(tab),true);
  for (const patch of [{pinned:true},{incognito:true},{groupId:12},{url:'chrome://settings'},{url:'file:///private'},{url:'chrome-extension://abc'}]) assert.equal(eligible({...tab,...patch}),false);
});
test('metadata omits paths, queries and unrelated properties', () => {
  assert.deepEqual(metadata({...tab,password:'no'}),{id:7,title:'A project',domain:'github.com'});
  assert.equal(metadata({...tab,title:'x'.repeat(500)}).title.length,240);
});
test('local baseline works without a network', () => {
  assert.equal(localCategory(tab),'build');
  assert.equal(localCategory({...tab,url:'https://example.org',title:'Unknown'}),'other');
});
test('strict gateway assignment validation rejects arbitrary IDs, categories, duplicates and missing coverage', () => {
  const good = {version:1,assignments:[{id:7,category:'learn',confidence:.9}]};
  assert.equal(validateAssignments(good,[7]).length,1);
  for (const patch of [{id:8},{category:'__proto__'},{confidence:'1'},{confidence:NaN},{confidence:2}]) assert.throws(() => validateAssignments({version:1,assignments:[{...good.assignments[0],...patch}]},[7]));
  assert.throws(() => validateAssignments({version:1,assignments:[]},[7]));
  assert.throws(() => validateAssignments({version:1,assignments:[good.assignments[0],good.assignments[0]]},[7,8]));
});
test('low confidence retains local category, clear judgments may change it', () => {
  assert.equal(applySuggestions([tab],[{id:7,category:'learn',confidence:.2}])[0].category,'build');
  assert.equal(applySuggestions([tab],[{id:7,category:'learn',confidence:.9}])[0].category,'learn');
});
test('gateway URLs reject insecure remote endpoints and credential-bearing URLs', () => {
  assert.equal(gatewayUrl('http://127.0.0.1:4318/classify').hostname,'127.0.0.1');
  assert.equal(gatewayUrl('https://example.com/classify').protocol,'https:');
  for (const url of ['http://example.com','https://user:pass@example.com','https://example.com/?key=secret','file:///tmp/a']) assert.throws(() => gatewayUrl(url));
});
test('server sanitizes metadata and batches real Choice questions', () => {
  const tabs = validateInput({version:1,tabs:[{...metadata(tab),url:tab.url}]});
  assert.equal(tabs[0].url,undefined);
  const request = buildRequest(tabs);
  assert.equal(request.model,'jev-latest');
  assert.equal(request.questions.tab_7.type,'choice');
  assert.match(request.questions.tab_7.instructions,/tabs\[0\]/);
  assert.ok(request.questions.tab_7.criteria.other);
  assert.throws(() => validateInput({version:1,tabs:[metadata(tab),metadata(tab)]}));
});
test('upstream response is normalized and rejected on malformed answer', () => {
  const response = {answers:{tab_7:{type:'choice',choice:'build',confidence:.9}}};
  assert.deepEqual(normalizeResponse(response,[metadata(tab)]),{version:1,assignments:[{id:7,category:'build',confidence:.9}]});
  assert.throws(() => normalizeResponse({answers:{tab_7:{type:'noul',noul:1}}},[metadata(tab)]));
});
test('server adapter uses documented endpoint and server-only bearer authentication', async () => {
  let captured;
  const result = await classify([metadata(tab)],'test-only-key',async (url, options) => {
    captured = {url,options}; return {ok:true,json:async () => ({answers:{tab_7:{type:'choice',choice:'build',confidence:.9}}})};
  });
  assert.equal(captured.url,'https://api.typesafe.ai/v1/systemone');
  assert.equal(captured.options.headers.Authorization,'Bearer test-only-key');
  assert.equal(result.assignments[0].category,'build');
  await assert.rejects(classify([metadata(tab)],'test-only',async () => ({ok:false})));
});
