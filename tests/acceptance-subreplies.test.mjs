import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Exercise the actual rendering/click handler with a minimal DOM and mocked
// already-parsed X responses. No live account requests or writes are made.
const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  async function fetchSubreplies('), source.indexOf('  function loadingState('));
class Node {
  constructor(tag, cls = '', text = '') { Object.assign(this, { tag, cls, text, children: [], dataset: {}, handlers: {}, attrs: {}, style: { setProperty() {} } }); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.handlers[k] = fn; }
}
function all(node) { return [node, ...node.children.flatMap(n => n instanceof Node ? all(n) : [])]; }
function setup(pages) {
  const state = { replies: [], expandedReplyIds: new Set(), fetchedReplyIds: new Set(), subreplyPages: new Map() };
  const calls = [];
  const ctx = vm.createContext({
    state, element: (t,c,s) => new Node(t,c,s), icon: () => new Node('icon'),
    document: { createTextNode: t => new Node('text','',t) },
    authorLine: () => new Node('header'), translatedTextBlock: m => new Node('text','',m.id),
    mediaGrid: () => null, attachmentCard: () => null, quoteCard: () => null,
    actionBar: () => new Node('actions'), renderReader() {}, notify() {},
    requestPage: async (type,payload) => { calls.push(payload); const result = pages[calls.length - 1]; if (result instanceof Error) throw result; return await result; },
    Core: { parseTweetDetail: x => x, replyCursorAfterPage: (prev,next,added) => added > 0 && next !== prev ? next || null : null },
    mergeReplies(items) { let added = 0; for (const item of items) if (!state.replies.some(r => r.id === item.id)) { state.replies.push(item); added++; } return added; }
  });
  vm.runInContext(code, ctx);
  const render = (m,d=0) => ctx.renderReply(m,d);
  const toggle = tree => all(tree).find(n => n.cls === 'tuzai-subreplies-toggle-btn');
  const click = async tree => { const b = toggle(tree); assert.ok(b, 'reply expansion control exists'); await b.handlers.click({ stopPropagation() {} }); };
  return { state, calls, render, toggle, click };
}
const parent = { id: '10', counts: { replies: 2 } };

test('a loaded branch expands, collapses and reopens without duplicating children', async () => {
  const h = setup([{ replies: [{ id: '11', inReplyToId: '10', counts: { replies: 0 } }], cursor: null }]);
  await h.click(h.render(parent));
  assert.equal(h.state.expandedReplyIds.has('10'), true);
  assert.ok(all(h.render(parent)).some(n => n.dataset.tweetId === '11'));
  await h.click(h.render(parent));
  assert.equal(h.state.expandedReplyIds.has('10'), false);
  await h.click(h.render(parent));
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.replies.length, 1);
});

test('a branch with a next-page cursor keeps a reachable way to load remaining siblings', async () => {
  const h = setup([{ replies: [{ id: '11', inReplyToId: '10', counts: { replies: 0 } }], cursor: 'next-children' }]);
  await h.click(h.render(parent));
  const tree = h.render(parent);
  const pagination = all(tree).find(n => /more|sentinel/.test(n.cls));
  assert.ok(pagination || !h.state.fetchedReplyIds.has('10'), 'next cursor must remain reachable, not mark the branch complete');
});

test('a deep reply with children retains an expansion or continuation control', () => {
  const h = setup([]);
  assert.ok(h.toggle(h.render(parent, 6)), 'depth-six reply must not silently hide deeper replies');
});

const child = (id, parentId = '10') => ({ id, inReplyToId: parentId, counts: { replies: 0 } });
async function more(h, model = parent) {
  const button = all(h.render(model)).find(n => n.cls === 'tuzai-subreplies-more-btn');
  assert.ok(button, 'branch continuation or retry is reachable');
  await button.handlers.click({ stopPropagation() {} });
}

test('loads the second page with the branch cursor and removes continuation at the end', async () => {
  const h = setup([{ replies: [child('11')], cursor: 'page2' }, { replies: [child('11'), child('12')], cursor: null }]);
  await h.click(h.render(parent));
  await more(h);
  assert.equal(h.calls[1].tweetId, '10');
  assert.equal(h.calls[1].cursor, 'page2');
  assert.deepEqual(h.state.replies.map(r => r.id), ['11', '12']);
  assert.ok(!all(h.render(parent)).some(n => n.cls === 'tuzai-subreplies-more-btn'));
});

for (const scenario of ['repeated cursor', 'no new IDs']) {
  test(`pagination terminates on ${scenario}`, async () => {
    const h = setup([{ replies: [child('11')], cursor: 'page2' }, { replies: [child(scenario === 'no new IDs' ? '11' : '12')], cursor: scenario === 'repeated cursor' ? 'page2' : 'page3' }]);
    await h.click(h.render(parent));
    await more(h);
    assert.equal(h.state.subreplyPages.get('10').cursor, null);
  });
}

test('failed pagination retries the same cursor without losing loaded replies', async () => {
  const h = setup([{ replies: [child('11')], cursor: 'page2' }, new Error('offline'), { replies: [child('12')], cursor: null }]);
  await h.click(h.render(parent));
  await more(h);
  assert.equal(h.state.subreplyPages.get('10').error, true);
  await more(h);
  assert.equal(h.calls[2].cursor, 'page2');
  assert.equal(h.state.replies.length, 2);
});

test('deep branches render children beyond level six with bounded indentation', async () => {
  const h = setup([{ replies: [child('11')], cursor: null }]);
  await h.click(h.render(parent, 8));
  const nodes = all(h.render(parent, 8));
  assert.ok(nodes.some(n => n.dataset.tweetId === '11' && n.dataset.depth === '9'));
  assert.ok(nodes.some(n => n.cls === 'tuzai-subreplies-container' && n.dataset.flat === 'true'));
});

test('concurrent branches track loading separately and ignore responses after closing', async () => {
  let resolveA, resolveB;
  const h = setup([new Promise(r => { resolveA = r; }), new Promise(r => { resolveB = r; })]);
  const a = h.click(h.render(parent));
  const b = h.click(h.render({ id: '20', counts: { replies: 1 } }));
  assert.equal(h.state.subreplyPages.get('10').loading, true);
  assert.equal(h.state.subreplyPages.get('20').loading, true);
  // Collapse and reopen while pending must not issue a duplicate request.
  await h.click(h.render(parent));
  await h.click(h.render(parent));
  assert.equal(h.calls.length, 2);
  h.state.subreplyPages = new Map();
  resolveA({ replies: [child('11')], cursor: null });
  resolveB({ replies: [child('21','20')], cursor: null });
  await Promise.all([a,b]);
  assert.equal(h.state.replies.length, 0);
});
