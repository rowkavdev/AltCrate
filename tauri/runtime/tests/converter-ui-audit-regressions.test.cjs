const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const web = path.resolve(__dirname, '../../casepilot/apps/web');
const ts = require(web + '/node_modules/typescript');
const { normalize } = require('../engine/operationHistory.cjs');

const jsx = (type, props, ...children) => ({ type, props: props || {}, children });
function nodes(node, out = []) {
  if (Array.isArray(node)) node.forEach(value => nodes(value, out));
  else if (node && typeof node === 'object') { out.push(node); (node.children || []).forEach(value => nodes(value, out)); }
  return out;
}
function words(node) {
  if (Array.isArray(node)) return node.map(words).join(' ');
  if (node && typeof node === 'object') return (node.children || []).map(words).join(' ');
  return node === null || node === undefined || typeof node === 'boolean' ? '' : String(node);
}
async function uiHarness(file, options = {}) {
  const viewModel = await import(web + '/src/converterViewModel.js');
  const navigation = await import(web + '/src/workspaceNavigation.js');
  let cursor = 0, slots = [], effects = [];
  const react = { __esModule: true, default: { createElement: jsx, Fragment: 'Fragment' },
    useMemo: fn => fn(), useCallback: fn => fn(),
    useEffect: fn => { effects.push(fn); },
    useState: initial => { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef: value => { const slot = cursor++; if (!(slot in slots)) slots[slot] = {current: value}; return slots[slot]; },
  };
  const code = ts.transpileModule(fs.readFileSync(web + '/src/' + file, 'utf8'), {compilerOptions: {jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS}}).outputText;
  const box = { exports: {}, Date: options.Date || Date, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    require: name => name === 'react' ? react : name.includes('language') ? {t: value => value} : name.includes('format') ? {formatNumber: String, formatTime: String} : name.includes('converterViewModel') ? viewModel : name.includes('workspaceNavigation') ? navigation : name.includes('theme') ? {readTheme: () => 'light', saveTheme() {}} : name.includes('package.json') ? {version: '0.4.0'} : name.endsWith('.css') ? {} : name.endsWith('.jsx') ? {__esModule: true, default: name.split('/').at(-1).replace('.jsx', ''), stepCaptions: {}} : new Proxy({}, {get: (_, key) => String(key)}),
  };
  vm.runInNewContext(code, box);
  return {render(props) { cursor = 0; effects = []; return box.exports.default(props); }, renderExport(name, props) {cursor = 0; return box.exports[name](props);}, effects: () => effects};
}
function pageModel(patch = {}) {
  const source = {id: 'source', label: 'Source'}, main = {id: 'main', label: 'Main'};
  return {now: Date.now(), accounts: [source, main], selectedIds: ['source'], snapshots: {}, converter: {phase: 'idle', rows: [], sentTokens: 0}, farmStatus: {phase: 'idle'}, opening: {phase: 'idle'}, refreshStatus: {phase: 'idle'}, actions: {refreshAccounts() {}, stopRefresh() {}}, setConverter() {}, setSelectedIds() {}, bridge: {}, ...patch};
}
const pageProps = model => ({model, ui: {converterSteps: ['transfer'], converterRouting: 'selected', destinationAccountId: 'main'}, onUiChange() {}});
const transferPreview = (patch = {}) => ({previewId: 'review', expiresAt: Date.now() + 300000, steps: ['transfer'], destination: {label: 'Main'}, rows: [{accountId: 'source', label: 'Source', membership: 'pro', route: 'tokens', effectiveSteps: ['transfer'], items: [], excludedItems: [], scopes: {tokens: 123456789}}], ...patch});
const summary = tree => nodes(tree).find(node => node.type === 'ConverterSequenceSummary');

// A first-account match used to persist the old pending operation instead of the changed operation.
test('operation history resolves the changed operation ID and never guesses an ambiguous account', () => {
  const rows = [{operationId: 'old', accountId: 'source', state: 'unconfirmed', stage: 'open'}, {operationId: 'current', accountId: 'source', state: 'failed', stage: 'sell'}];
  const event = {type: 'token-converter', accountId: 'source', operationId: 'current', status: {rows}};
  const row = normalize(event, Date.now());
  assert.equal(row.operationId, 'current'); assert.equal(row.result, 'failed'); assert.equal(row.kind, 'sell');
  assert.equal(normalize({...event, operationId: 'missing'}, Date.now()), null);
  assert.equal(normalize({...event, operationId: undefined}, Date.now()), null);
});

test('the workspace refresh consumer uses the event operation instead of another operation from the account', () => {
  const source = fs.readFileSync(web + '/src/useWorkspaceModel.js', 'utf8');
  const handler = source.slice(source.indexOf("      if(event.type==='token-converter')"), source.indexOf("      if(event.type==='account-session')"));
  const refreshed = [], context = {event: {type: 'token-converter', accountId: 'source', operationId: 'current', status: {rows: [{operationId: 'old', accountId: 'source', state: 'confirmed'}, {operationId: 'current', accountId: 'source', state: 'running'}]}}, currentConverter: {}, setConverter() {}, refreshAccount: id => refreshed.push(id)};
  vm.runInNewContext(handler, context); assert.deepEqual(refreshed, []);
  context.event.status.rows[1] = {operationId: 'current', accountId: 'source', destinationAccountId: 'main', state: 'stopped'};
  vm.runInNewContext(handler, context); assert.deepEqual(refreshed, ['source', 'main']);
  refreshed.length = 0; context.event.operationId = 'missing';
  vm.runInNewContext(handler, context); assert.deepEqual(refreshed, []);
  delete context.event.operationId;
  vm.runInNewContext(handler, context); assert.deepEqual(refreshed, []);
});

test('account reading blocks preparation and its Stop remains enabled while converter preparation runs', async () => {
  let prepared = 0, stopped = 0;
  const h = await uiHarness('pages/TokenConverterPage.jsx'), model = pageModel({refreshStatus: {phase: 'running'}, bridge: {prepareTokenConverter: async () => {prepared++; return transferPreview();}}, actions: {refreshAccounts() {}, stopRefresh() {stopped++;}}}), props = pageProps(model);
  let tree;
  for (const phase of ['running', 'waiting', 'stopping']) {model.refreshStatus = {phase}; tree = h.render(props); assert.equal(summary(tree).props.disabled, true, phase); await summary(tree).props.onReview(); assert.equal(prepared, 0, phase);}
  model.refreshStatus = {phase: 'running'};
  model.converter = {phase: 'preparing', rows: [], preparation: {completed: 0, total: 1}};
  tree = h.render(props);
  const stop = nodes(tree).find(node => node.type === 'Button' && node.props['aria-label'] === 'Parar leitura');
  assert.equal(!!stop.props.disabled, false); stop.props.onClick(); assert.equal(stopped, 1);
});

test('Pro direct and adapted transfer reviews disclose each account amount and aggregate token scope', async () => {
  const h = await uiHarness('components/ConverterReviewDialog.jsx');
  for (const preview of [transferPreview(), transferPreview({steps: ['convert-inventory', 'mint', 'transfer', 'convert-received'], rows: [...transferPreview().rows, {...transferPreview().rows[0], accountId: 'second', label: 'Second', effectiveSteps: ['convert-inventory', 'transfer'], scopes: {tokens: 10}}]})]) {
    const text = words(h.render({preview}));
    assert.match(text, /123456789/); assert.match(text, /Tokens no âmbito do envio/);
    if (preview.rows.length === 2) assert.match(text, /123456799/);
  }
});

test('confirm revalidation exposes a working Stop and current read progress inside the review', async () => {
  const h = await uiHarness('components/ConverterReviewDialog.jsx'); let stops = 0;
  const tree = h.render({preview: transferPreview(), pending: true, preparation: {completed: 2, total: 4, label: 'Second'}, onStop: () => stops++});
  const stop = nodes(tree).find(node => node.type === 'Button' && /Parar/.test(words(node)));
  assert.ok(stop, 'Stop is reachable from the pending review'); assert.equal(!!stop.props.disabled, false);
  stop.props.onClick(); assert.equal(stops, 1);
  const progress = nodes(tree).find(node => node.type === 'progress'); assert.equal(progress.props.value, 2); assert.equal(progress.props.max, 4);
  assert.match(words(tree), /Second/);
});

test('a review rejects confirmation after its deadline even before the next render', async () => {
  let now = Date.now(), starts = 0;
  class ClockDate extends Date {static now() {return now;}}
  const h = await uiHarness('pages/TokenConverterPage.jsx', {Date: ClockDate});
  const model = pageModel({bridge: {prepareTokenConverter: async () => transferPreview({expiresAt: now + 1000}), startTokenConverter: async () => {starts++; return {phase: 'running', rows: []};}}}), props = pageProps(model);
  await summary(h.render(props)).props.onReview();
  const review = nodes(h.render(props)).find(node => node.type === 'ConverterReviewDialog');
  now += 1001; await review.props.onConfirm(); assert.equal(starts, 0);
  model.now = now;
  const expired = nodes(h.render(props)).find(node => node.type === 'ConverterReviewDialog'); assert.equal(expired.props.stale, true); assert.equal(expired.props.expired, true);
});

test('expired review disables confirmation and provides a fresh review action', async () => {
  const h = await uiHarness('components/ConverterReviewDialog.jsx'); let reviewed = 0;
  const tree = h.render({preview: transferPreview({expiresAt: Date.now() - 1}), expired: true, onReview: () => reviewed++});
  assert.match(words(tree), /revisão expirou/i);
  const confirm = nodes(tree).find(node => node.type === 'Button' && /Confirmar/.test(words(node))); assert.equal(confirm.props.disabled, true);
  const review = nodes(tree).find(node => node.type === 'Button' && /Rever novamente/.test(words(node))); assert.ok(review); review.props.onClick(); assert.equal(reviewed, 1);
});

test('idle snapshot membership expires locally and visibility resumption updates the clock', async () => {
  const {converterMembership} = await import(web + '/src/converterViewModel.js');
  const source = fs.readFileSync(web + '/src/useWorkspaceModel.js', 'utf8'), part = source.slice(source.indexOf('  const needsClock='), source.indexOf('  const readings ='));
  let now = Date.parse('2026-10-26T12:00:00Z'), tick = now, timeout, resumed;
  class ClockDate extends Date {static now() {return now;}}
  const snapshot = {membership: 'pro', observedAt: new Date(now).toISOString()};
  vm.runInNewContext(part, {snapshots: {source: snapshot}, running: false, accountLogin: {phase: 'idle'}, refreshStatus: {}, farmStatus: {}, opening: {}, converter: {}, Date: ClockDate, document: {visibilityState: 'visible', addEventListener(type, fn) {resumed = fn;}, removeEventListener() {}}, useEffect: fn => fn(), setTick: value => {tick = value;}, setInterval() {}, clearInterval() {}, setTimeout(fn, delay) {timeout = {fn, delay};}, clearTimeout() {}});
  assert.ok(timeout, 'An idle snapshot gets an expiry deadline'); assert.equal(timeout.delay, 300001);
  now += timeout.delay; timeout.fn(); assert.equal(converterMembership(snapshot, tick), 'unknown');
  now += 1000; resumed(); assert.equal(tick, now);
});

test('active pending recovery is visible next to the CTA and takes priority over old rows for the same account', async () => {
  const h = await uiHarness('pages/TokenConverterPage.jsx'); let verified;
  const rows = Array.from({length: 45}, (_, i) => ({operationId: 'historical-' + i, accountId: 'source', state: 'stopped', sourceLabel: 'Source', canStop: true, canReviewNext: true, pendingStickers: 0, pendingItems: 0, handoffCounts: {source: 0, destination: 0}}));
  rows.splice(40, 0, {operationId: 'active-pending', accountId: 'source', state: 'unconfirmed', sourceLabel: 'Source', canVerify: true, message: 'Resposta perdida'});
  const model = pageModel({converter: {phase: 'idle', rows}, bridge: {verifyTokenConversion: async id => {verified = id; return {phase: 'idle', rows};}}});
  const tree = h.render(pageProps(model)), recovery = summary(tree).props.recovery;
  assert.equal(summary(tree).props.pendingCount, 1); assert.ok(recovery, 'Pending recovery accompanies the primary action'); assert.match(words(recovery), /Resposta perdida/);
  const action = nodes(recovery).find(node => typeof node.type === 'function' && node.type.name === 'Recovery'); assert.ok(action); assert.equal(action.props.row.operationId, 'active-pending'); await action.props.onVerify(action.props.row.operationId); assert.equal(verified, 'active-pending');
  assert.equal(nodes(tree).find(node => node.type === 'Button' && node.props['aria-label'] === 'Detalhes de Source').children.some(value => value === 'Por confirmar'), true);
});

test('capsule stages name the fixed Atlanta2017 capsule in setup and final review', async () => {
  const picker = await uiHarness('components/ConverterStepPicker.jsx');
  assert.match(words(picker.render({selectedSteps: ['buy', 'open'], routing: 'selected', onChange() {}})), /Atlanta2017/);
  const review = await uiHarness('components/ConverterReviewDialog.jsx');
  assert.match(words(review.render({preview: transferPreview({steps: ['buy'], rows: [{...transferPreview().rows[0], effectiveSteps: ['buy'], scopes: {money: 15}}]})})), /Atlanta2017/);
});

// Revalidation remains a converter operation for global UI interlocks, and idle pending work cannot be presented as ready.
test('the application header reports revalidation as running and unresolved results as requiring attention', async () => {
  const h = await uiHarness('AppShell.jsx'), base = {page: 'converter', farmStatus: {phase: 'idle'}, onNavigate() {}};
  const working = words(h.render({...base, converterStatus: {phase: 'revalidating', rows: []}}));
  assert.match(working, /Conversor em execução/);
  const pending = words(h.render({...base, converterStatus: {phase: 'idle', rows: [{state: 'unconfirmed'}]}}));
  assert.match(pending, /Resultados por confirmar/);
  const protectedClosure = words(h.render({...base, converterStatus: {phase: 'idle', rows: [{state: 'unresolved', lockedAccountIds: ['source']}]}}));
  assert.match(protectedClosure, /Resultados por confirmar/);
});

test('progression controls retain their converter interlock during confirm revalidation', async () => {
  const h = await uiHarness('pages/progressionShared.jsx');
  const tree = h.renderExport('ProgressionState', {controller: {}, account: {id: 'source'}, model: {converter: {phase: 'revalidating'}}});
  assert.match(words(tree), /Há outra operação em curso/);
});

test('an idle review updates its expiry from a local deadline without a network read', async () => {
  let now = Date.now(), deadline; class ClockDate extends Date {static now() {return now;}}
  const h = await uiHarness('pages/TokenConverterPage.jsx', {Date: ClockDate, setTimeout: (fn, delay) => {deadline = {fn, delay};}});
  const model = pageModel({bridge: {prepareTokenConverter: async () => transferPreview({expiresAt: now + 1000})}}), props = pageProps(model);
  await summary(h.render(props)).props.onReview(); h.render(props);
  h.effects().forEach(effect => effect()); assert.equal(deadline.delay, 1001);
  now += 1001; deadline.fn();
  const review = nodes(h.render(props)).find(node => node.type === 'ConverterReviewDialog'); assert.equal(review.props.expired, true);
});

test('closed unknown outputs retain visible scope restrictions while the safe independent sale remains available', async () => {
  const {converterGuidance} = await import(web + '/src/converterViewModel.js');
  const status = {rows: [{operationId: 'closed-unknown', accountId: 'source', state: 'unresolved', lockedAccountIds: ['source'], allowedIndependentSteps: ['sell']}]};
  const base = {status, sourceIds: ['source'], independent: true};
  assert.equal(converterGuidance({...base, steps: ['open']}).issues.some(issue => issue.code === 'unconfirmed'), true);
  assert.equal(converterGuidance({...base, steps: ['sell']}).issues.some(issue => issue.code === 'unconfirmed'), false);
});
