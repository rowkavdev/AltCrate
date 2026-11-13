const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountQueue } = require('../electron/accountQueue.cjs');

test('same account writes run in order; separate accounts overlap', async () => {
  const queue = createAccountQueue();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const first = queue.run('a', async () => { order.push('a1'); await gate; });
  const second = queue.run('a', async () => { order.push('a2'); });
  const other = queue.run('b', async () => { order.push('b'); });
  await other;
  assert.deepEqual(order, ['a1', 'b']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a1', 'b', 'a2']);
});
