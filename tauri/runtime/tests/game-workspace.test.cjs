const test = require('node:test');
const assert = require('node:assert/strict');
const source = '../../casepilot/apps/web/src/gameWorkspace.js';

test('table selection reaches accounts beyond the old first twenty without exceeding twenty open tables', async () => {
  const {resolveGameTables} = await import(source);
  const accounts = Array.from({length: 51}, (_, i) => ({id: `a${i + 1}`, label: `Conta ${i + 1}`}));
  assert.equal(resolveGameTables(accounts).length, 20);
  assert.deepEqual(resolveGameTables(accounts, ['a51', 'a2', 'missing', 'a51']).map(a => a.id), ['a2', 'a51']);
  assert.equal(resolveGameTables(accounts, accounts.map(a => a.id)).length, 20);
  assert.deepEqual(resolveGameTables(accounts, []), []);
});

test('group execution uses only selected open Blackjack tables, once per account', async () => {
  const {selectedBlackjackIds} = await import(source);
  assert.deepEqual(selectedBlackjackIds([{id:'a'}, {id:'b'}, {id:'c'}], ['a', 'b', 'c', 'd', 'a'], {b:{game:'dice'}}), ['a', 'c']);
});

test('search and game filters affect the view without changing the table or betting selection', async () => {
  const {filterGameTables} = await import(source);
  const tables = [{id:'a',label:'Principal'}, {id:'b',label:'Açores'}, {id:'c',label:'Backup'}];
  const cards = {b:{game:'dice'}};
  assert.deepEqual(filterGameTables(tables, 'acores', 'all', cards).map(a=>a.id), ['b']);
  assert.deepEqual(filterGameTables(tables, '', 'blackjack', cards).map(a=>a.id), ['a','c']);
  assert.equal(tables.length, 3);
});
