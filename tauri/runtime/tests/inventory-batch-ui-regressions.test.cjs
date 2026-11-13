const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const web = path.resolve(__dirname, '../../casepilot/apps/web');
const ts = require(web + '/node_modules/typescript');
const jsx = (type, props, ...children) => ({type, props: props || {}, children});
const nodes = (node, result = []) => {
  if (Array.isArray(node)) node.forEach(value => nodes(value, result));
  else if (node && typeof node === 'object') {result.push(node); (node.children || []).forEach(value => nodes(value, result));}
  return result;
};
const words = node => Array.isArray(node) ? node.map(words).join(' ') : node && typeof node === 'object' ? (node.children || []).map(words).join(' ') : node == null || typeof node === 'boolean' ? '' : String(node);
function harness(file = 'InventoryBatchPanel.jsx', options = {}) {
  let cursor = 0, slots = [], scheduled = [];
  const react = {__esModule: true, default: {createElement: jsx, Fragment: 'Fragment'}, useMemo: fn => fn(),
    useState(initial) {const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => {slots[i] = typeof value === 'function' ? value(slots[i]) : value;}];},
    useRef(initial) {const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i];},
    useEffect(fn, deps) {const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((value, n) => !Object.is(value, old.deps?.[n]))) {scheduled.push(() => {old?.cleanup?.(); const cleanup = fn(); slots[i] = {deps, cleanup};});}},
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const box = {exports: {}, Date: options.Date || Date, setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout,
      require(name) {
        if (name === 'react') return react;
        if (name.includes('language')) return {t: value => value, getLocale: () => 'en-GB'};
        if (name.includes('format')) return {formatNumber: String, formatTime: String, formatMoney: String};
        if (name.endsWith('.css')) return {};
        if (name.includes('useInventoryActions')) return {useInventoryActions: () => ({})};
        if (name.endsWith('.jsx')) return {__esModule: true, default: path.basename(name, '.jsx'), DisclosurePanel: 'DisclosurePanel', InventoryOperations: 'InventoryOperations', InventoryViews: 'InventoryViews'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
        return new Proxy({}, {get: (_, name) => name});
      },
    };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS}}).outputText;
    vm.runInNewContext(code, box, {filename}); cache.set(filename, box.exports); return box.exports;
  }
  const module = load(path.join(web, 'src/pages', file));
  return {render(props, name = 'default') {cursor = 0; return module[name](props);}, flushEffects() {const pending = scheduled; scheduled = []; pending.forEach(fn => fn());}};
}
const flush = async () => {for (let i = 0; i < 5; i++) await Promise.resolve();};
const row = (itemId, state = 'queued', accountId = 'source', storageUnitId = null) => ({ref: {accountId, itemId, storageUnitId, page: 1, name: itemId}, preview: {item: {id: itemId, name: itemId}, sourceLabel: accountId, steps: []}, state, operationId: state === 'queued' ? null : 'op-' + itemId, message: '', finalLocation: state === 'confirmed' ? {accountId, location: 'sold'} : null});
const batch = (id, state, rows, patch = {}) => ({batchId: id, kind: 'sell', state, items: rows, createdAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z', expiresAt: Date.now() + 300000, limitation: '', ...patch});
const entry = (itemId, accountId = 'source', storageUnitId = null) => ({key: accountId + ':' + itemId, item: {id: itemId, name: itemId}, ref: {accountId, itemId, storageUnitId, page: 1}});
async function mount(values, options = {}) {
  const h = harness(), listeners = [];
  let selection = options.selection || [];
  const props = {model: {accounts: [{id: 'source', label: 'Source'}, {id: 'other', label: 'Other'}], bridge: {prepareInventoryBatch: async () => {}, listInventoryBatches: async () => values, onEvent(fn) {listeners.push(fn); return () => {};}, ...options.bridge}}, accountId: 'source', onSelectionChange(value) {selection = typeof value === 'function' ? value(selection) : value;}};
  const render = () => h.render({...props, selection});
  render(); h.flushEffects(); await flush(); render(); h.flushEffects(); await flush();
  return {h, props, render, selection: () => selection, emit(value) {listeners.forEach(fn => fn({type: 'inventory-batch', batch: value}));}};
}
const review = tree => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'InventoryBatchReview');

test('partial batch confirmation removes only the confirmed source item while preserving other accounts and storage scopes', async () => {
  const initial = batch('active', 'running', [row('one', 'submitting'), row('two')]);
  const h = await mount([initial], {selection: [entry('one'), entry('two'), entry('one', 'other'), entry('one', 'source', 44)]});
  h.emit({...initial, updatedAt: '2026-10-26T10:00:01.000Z', items: [row('one', 'confirmed'), row('two')]});
  assert.deepEqual(h.selection().map(value => [value.ref.accountId, value.ref.itemId, value.ref.storageUnitId]), [['source', 'two', null], ['other', 'one', null], ['source', 'one', 44]]);
});

test('an older response cannot replace a newer confirmed batch snapshot', async () => {
  const old = batch('active', 'running', [row('one', 'submitting')]);
  const h = await mount([old]);
  h.emit({...old, state: 'completed', updatedAt: '2026-10-26T10:00:02.000Z', items: [row('one', 'confirmed')]});
  h.emit(old);
  assert.equal(review(h.render()).props.batch.items[0].state, 'confirmed');
});

test('initial historical confirmations do not erase newly selected returned items', async () => {
  const h = await mount([batch('history', 'completed', [row('one', 'confirmed')])], {selection: [entry('one')]});
  assert.deepEqual(h.selection().map(value => value.key), ['source:one']);
});

test('batch autoselection follows the displayed account and keeps completed work in a closed history disclosure', async () => {
  const h = await mount([batch('other-active', 'paused', [row('other-item', 'unconfirmed', 'other')]), batch('current-active', 'paused', [row('one', 'unconfirmed')]), batch('old-completed', 'completed', [row('old', 'confirmed')])]);
  let tree = h.render();
  assert.equal(review(tree).props.batch.batchId, 'current-active');
  const history = nodes(tree).find(node => node.type === 'details' && /Lotes concluídos/.test(words(node)));
  assert.ok(history); assert.notEqual(history.props.open, true);
  assert.ok(nodes(history).some(node => node.type === 'option' && node.props.value === 'old-completed'));
  assert.ok(!nodes(tree).some(node => node.type === 'option' && node.props.value === 'other-active'));
  h.props.accountId = 'other'; tree = h.render(); h.h.flushEffects(); tree = h.render();
  assert.equal(review(tree).props.batch.batchId, 'other-active');
});

test('unknown item results remain in attention even when the batch claims to be completed', async () => {
  const h = await mount([batch('unknown', 'completed', [row('one', 'unresolved')])]);
  const tree = h.render(), attention = nodes(tree).find(node => node.props['aria-label'] === 'Lotes a acompanhar');
  assert.ok(attention); assert.ok(nodes(attention).some(node => node.type === 'option' && node.props.value === 'unknown'));
});

test('expired batch reviews disable execution and resumption while verification remains available', () => {
  const h = harness(), expired = batch('expired', 'review', [row('one')], {expiresAt: Date.now() - 1});
  let tree = h.render({batch: expired}, 'InventoryBatchReview');
  const execute = nodes(tree).find(node => node.type === 'button' && words(node) === 'Executar lote');
  assert.equal(execute.props.disabled, true); assert.match(words(tree), /revisão expirou/i);
  tree = h.render({batch: {...expired, state: 'paused'}}, 'InventoryBatchReview');
  assert.equal(nodes(tree).find(node => node.type === 'button' && words(node) === 'Continuar itens por executar').props.disabled, true);
  tree = h.render({batch: {...expired, state: 'paused', items: [row('one', 'unconfirmed')]}}, 'InventoryBatchReview');
  assert.equal(nodes(tree).find(node => node.type === 'button' && words(node) === 'Verificar estado').props.disabled, false);
});

test('the execution callback rechecks the review deadline before sending', () => {
  let now = Date.now(), sent = 0; class ClockDate extends Date {static now() {return now;}}
  const h = harness('InventoryBatchPanel.jsx', {Date: ClockDate});
  const tree = h.render({batch: batch('review', 'review', [row('one')], {expiresAt: now + 100}), onStart() {sent++;}}, 'InventoryBatchReview');
  const execute = nodes(tree).find(node => node.type === 'button' && words(node) === 'Executar lote');
  now += 101; execute.props.onClick(); assert.equal(sent, 0);
});

test('confirmed item rows are collapsed while unconfirmed rows remain directly visible', () => {
  const h = harness(), tree = h.render({batch: batch('partial', 'paused', [row('done', 'confirmed'), row('unknown', 'unconfirmed')])}, 'InventoryBatchReview');
  const history = nodes(tree).find(node => node.type === 'details' && /Itens confirmados/.test(words(node)));
  assert.ok(history); assert.notEqual(history.props.open, true); assert.match(words(history), /done/); assert.doesNotMatch(words(history), /unknown/);
});
