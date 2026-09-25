import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({ URL, globalThis: {} });
vm.runInContext(readFileSync(new URL('../extension/core.js', import.meta.url), 'utf8'), context);
const Core = context.globalThis.TuzaiCore;

function reply(text, { target, range } = {}) {
  const mentions = [...text.matchAll(/@([A-Za-z0-9_]+)/g)].map(m => ({
    screen_name: m[1], indices: [m.index, m.index + m[0].length]
  }));
  return Core.tweetModel({
    rest_id: '200',
    legacy: {
      full_text: text, in_reply_to_status_id_str: '100',
      ...(target ? { in_reply_to_screen_name: target } : {}),
      ...(range ? { display_text_range: range } : {}),
      entities: { user_mentions: mentions }
    },
    core: { user_results: { result: {
      rest_id: '300', legacy: { name: 'Fixture author', screen_name: 'fixture_author' }
    } } }
  });
}

test('hidden recipient is removed while active @grok and its link remain', () => {
  const text = '@alice @grok 请解释';
  const model = reply(text, { target: 'alice', range: [7, text.length] });
  assert.equal(model.text, '@grok 请解释');
  assert.equal(model.entities.length, 1);
  assert.equal(model.entities[0].url, 'https://x.com/grok');
  assert.equal(model.text.slice(model.entities[0].start, model.entities[0].end), '@grok');
});

test('a visible mention of another account is preserved', () => {
  const text = '@grok 请解释';
  const model = reply(text, { target: 'alice', range: [0, text.length] });
  assert.equal(model.text, text);
});

test('display range starting at zero preserves an explicitly visible recipient mention', () => {
  const text = '@alice 我主动提到你';
  const model = reply(text, { target: 'alice', range: [0, text.length] });
  assert.equal(model.text, text);
  assert.equal(model.entities[0].url, 'https://x.com/alice');
});

test('missing recipient metadata must not guess away the first active mention', () => {
  const text = '@grok 请解释';
  const model = reply(text);
  assert.equal(model.text, text);
  assert.equal(model.entities[0].url, 'https://x.com/grok');
});

test('a reply target without a display range does not justify deletion', () => {
  const text = '@alice 请看这里';
  assert.equal(reply(text, { target: 'alice' }).text, text);
});

test('invalid ranges, incomplete handles and non-mention prefixes preserve text', () => {
  const text = '@alice @grok 请解释';
  for (const range of [[7], [-1, text.length], [7, 2], [7, 999], [2, text.length], ['7', text.length]]) {
    assert.equal(reply(text, { target: 'alice', range }).text, text);
  }
  const body = '请找 @grok';
  assert.equal(reply(body, { range: [3, body.length] }).text, body);
});

test('multiple hidden recipients leave the active mention and its offsets intact', () => {
  const prefix = '@alice @bob ';
  const body = '@grok 请解释';
  const model = reply(prefix + body, { range: [prefix.length, (prefix + body).length] });
  assert.equal(model.text, body);
  assert.equal(model.entities.length, 1);
  assert.equal(model.text.slice(model.entities[0].start, model.entities[0].end), '@grok');
});

test('a reply containing only mentions is not turned into a blank card', () => {
  const text = '@alice ';
  assert.equal(reply(text, { range: [text.length, text.length] }).text, text);
});
