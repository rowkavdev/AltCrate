const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountRegistry } = require('../engine/accounts.cjs');

test('account registry persists public labels and rejects duplicate labels', async () => {
  let saved = [];
  const store = createAccountRegistry({
    load: async () => saved,
    save: async (accounts) => { saved = accounts; },
  });
  await store.ready();
  const account = await store.add('Teste A', 'persist:caseclicker-a');
  assert.equal(account.label, 'Teste A');
  await assert.rejects(() => store.add('teste a', 'persist:caseclicker-b'), /já existe/i);
  assert.equal(saved.length, 1);
  assert.equal(JSON.stringify(saved).includes('password'), false);
  await store.remove(account.id);
  assert.deepEqual(saved, []);
});

test('registry accepts a hundred distinct accounts and rejects the next', async () => {
  let saved = [];
  const store = createAccountRegistry({ load: async () => saved, save: async (accounts) => { saved = accounts; } });
  for (let index = 1; index <= 100; index++) {
    await store.add(`Conta ${index}`, `persist:caseclicker-${index}`);
  }
  assert.equal((await store.list()).length, 100);
  await assert.rejects(() => store.add('Conta 101', 'persist:caseclicker-101'), /100/);
  assert.equal(saved.length, 100);
});
