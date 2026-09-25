import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const ctx = vm.createContext({ URL, globalThis: {} });
vm.runInContext(readFileSync('extension/core.js', 'utf8'), ctx);
const Core = ctx.globalThis.TuzaiCore;
function poll(counts, final = false) {
  const bindings = counts.flatMap((count,i) => [
    { key: `choice${i+1}_label`, value: { string_value: `选项${i+1} &amp; 中文` } },
    { key: `choice${i+1}_count`, value: { string_value: String(count) } }
  ]);
  bindings.push({ key: 'counts_are_final', value: { boolean_value: final } });
  return Core.tweetModel({ rest_id: '100', legacy: { full_text: '投票验收', entities: {} }, card: { name: `poll${counts.length}choice_text_only`, legacy: { binding_values: bindings } } });
}
test('zero-vote active poll shows finite zero percentages and no winning option', () => {
  const a = poll([0,0]).attachment;
  assert.equal(a.totalVotes, 0);
  assert.equal(a.isFinal, false);
  assert.ok(a.options.every(o => o.percentage === '0.0' && !o.isWinner));
});
test('four options preserve order, Chinese labels, counts and percentages', () => {
  const a = poll([1,2,3,4]).attachment;
  assert.equal(a.options.length, 4);
  assert.equal(a.totalVotes, 10);
  assert.equal(a.options[0].label, '选项1 & 中文');
  assert.equal(a.options[3].percentage, '40.0');
  assert.equal(a.options.filter(o => o.isWinner).length, 1);
});
test('tied leaders are both marked and finalized status is retained', () => {
  const a = poll([4,4,2], true).attachment;
  assert.equal(a.isFinal, true);
  assert.equal(a.options.filter(o => o.isWinner).length, 2);
});
test('three equal options round consistently without NaN', () => {
  assert.ok(poll([1,1,1]).attachment.options.every(o => o.percentage === '33.3'));
});
class Node {
  constructor(tag,cls='',text='') { Object.assign(this,{tag,cls,text,style:{},children:[]}); }
  append(...nodes) { this.children.push(...nodes); }
}
const content = readFileSync('extension/content.js','utf8');
const renderer = vm.createContext({element: (t,c,s) => new Node(t,c,s), document: {createElement:t=>new Node(t)},formatCount:String});
vm.runInContext(content.slice(content.indexOf('  function pollCard('),content.indexOf('  function attachmentCard(')), renderer);
const all = n => [n,...n.children.flatMap(all)];
test('actual poll renderer displays totals, active status and bounded bars', () => {
  const nodes = all(renderer.pollCard(poll([1,3])));
  assert.ok(nodes.some(n => n.text === '4 次投票 · 进行中'));
  assert.ok(nodes.some(n => n.cls === 'tuzai-poll-fill' && n.style.width === '75%'));
  assert.ok(nodes.some(n => n.text === '选项1 & 中文'));
});
test('compact final poll renders option image and result status', () => {
  const model = poll([1,3],true);
  model.attachment.options[0].image = 'https://example.com/option.png';
  const tree = renderer.pollCard(model,true), nodes = all(tree);
  assert.ok(tree.cls.includes('tuzai-poll-compact'));
  assert.ok(nodes.some(n => n.tag === 'img' && n.alt === '选项1 & 中文'));
  assert.ok(nodes.some(n => n.text === '4 次投票 · 最终结果'));
});
