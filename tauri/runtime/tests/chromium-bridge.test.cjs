'use strict';

const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createChromiumBridge } = require('../engine/chromiumBridge.cjs');

function fixture(t) {
  const children = [];
  const events = [];
  const bridge = createChromiumBridge({
    executable: 'test-chromium',
    dataDirectory: '/test-data',
    onEvent: event => events.push(event),
    spawnProcess() {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.sent = [];
      child.stdin.on('data', data => child.sent.push(JSON.parse(data.toString())));
      child.kills = 0;
      child.kill = () => { child.kills += 1; };
      children.push(child);
      return child;
    },
  });
  t.after(() => bridge.close());
  return { bridge, children, events };
}

function respond(child, request, result) {
  child.stdout.write(JSON.stringify({ type: 'result', id: request.id, result }) + '\n');
}

test('decodes split UTF-8 and handles multiple complete messages in a chunk', async t => {
  const { bridge, children, events } = fixture(t);
  const first = bridge.request('session.info');
  const second = bridge.request('session.info');
  const [child] = children;
  const [firstRequest, secondRequest] = child.sent;
  const result = { name: 'sessão' };
  const event = { type: 'native-event', id: 'login-1', event: 'did-finish-load' };
  const data = Buffer.from([
    JSON.stringify({ type: 'result', id: firstRequest.id, result }),
    JSON.stringify(event),
    JSON.stringify({ type: 'result', id: secondRequest.id, result: 2 }),
    '',
  ].join('\n'));
  const split = data.indexOf(Buffer.from('ã')) + 1;
  child.stdout.write(data.subarray(0, split));
  child.stdout.write(data.subarray(split));
  assert.deepEqual(await Promise.all([first, second]), [result, 2]);
  assert.deepEqual(events, [event]);
});

test('rejects an oversized frame before its newline and never replays requests', async t => {
  const { bridge, children, events } = fixture(t);
  const created = bridge.request('login.create', { id: 'login-1' });
  const [child] = children;
  respond(child, child.sent[0], null);
  await created;

  const mutation = bridge.request('login.fetch', { method: 'POST' });
  const read = bridge.request('session.info');
  const rejected = Promise.all([
    assert.rejects(mutation, /resposta inválida/),
    assert.rejects(read, /resposta inválida/),
  ]);

  // Each character is two bytes. The cap applies to the UTF-8 bytes on the pipe.
  const chunk = Buffer.from('é'.repeat(512 * 1024));
  for (let i = 0; i < 32; i++) child.stdout.write(chunk);
  assert.equal(child.kills, 0);
  child.stdout.write(Buffer.from('x'));
  assert.equal(child.kills, 1);
  await rejected;
  assert.deepEqual(events, [{ type: 'native-event', id: 'login-1', event: 'closed' }]);
  assert.equal(children.length, 1);

  const fresh = bridge.request('session.info');
  const next = children[1];
  assert.deepEqual(next.sent.map(request => request.method), ['session.info']);
  assert.notEqual(next.sent[0].id, child.sent[2].id);
  respond(child, next.sent[0], 'old helper');
  child.emit('exit', 1);
  respond(next, next.sent[0], 'new helper');
  assert.equal(await fresh, 'new helper');
  assert.equal(events.length, 1);
});

test('rejects a complete JSON value when stdout ends before its delimiter', async t => {
  const { bridge, children } = fixture(t);
  const pending = bridge.request('session.info');
  const rejected = assert.rejects(pending, /resposta inválida/);
  const [child] = children;
  const ended = once(child.stdout, 'end');
  child.stdout.end(JSON.stringify({ type: 'result', id: child.sent[0].id, result: 'partial' }));
  await ended;
  assert.equal(child.kills, 1);
  await rejected;
});

test('rejects pending requests when the helper exits before replying', async t => {
  const { bridge, children } = fixture(t);
  const controller = new AbortController();
  const pending = bridge.request('login.fetch', { method: 'POST' }, controller.signal);
  const rejected = assert.rejects(pending, /foi fechado/);
  const [child] = children;
  child.emit('exit', 1);
  await rejected;
  controller.abort();
  assert.equal(child.kills, 0);
  assert.equal(child.sent.length, 1);
  assert.equal(children.length, 1);
});
