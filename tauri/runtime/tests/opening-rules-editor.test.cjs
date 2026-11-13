const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOpeningRules } = require('../engine/openingPolicy.cjs');
const load = () => import('../../casepilot/apps/web/src/openingRulesViewModel.js');
const skins = [{ name: 'AK-47 | Slate' }, { name: '★ Butterfly Knife | Fade' }];
const storage = { destinationAccountId: 'other-account', storageUnitId: 'a'.repeat(24) };

test('editor validates the same ordered rules as the production policy', async () => {
  const { validateRuleSet } = await load();
  const variants = [
    [{ name: skins[0].name, action: 'keep', conditions: { floatMax: 0.01, patterns: ['2', '1', '2'], statTrak: false, souvenir: false, eventName: ' Event ', topN: 100 } }, { name: skins[0].name, action: 'sell' }],
    [{ name: 'StatTrak™ AK-47 | Slate (Factory New)', action: 'storage', ...storage }],
    [{ name: skins[0].name, action: 'keep', conditions: { floatMin: 0.8, floatMax: 0.2 } }],
    [{ name: skins[0].name, action: 'sell', conditions: { topN: 1.5 } }],
    [{ name: skins[0].name, action: 'sell', conditions: { patterns: ['', '2'] } }],
    [{ name: skins[0].name, action: 'storage', ...storage, storageUnitId: 'invalid' }],
    [{ name: 'Missing skin', action: 'keep' }],
    [{ name: skins[0].name, action: 'keep' }, { name: 'Souvenir AK-47 | Slate', action: 'sell' }],
    [{ name: skins[0].name, action: 'keep', id: 'same' }, { name: skins[1].name, action: 'sell', id: 'same' }],
    [{ name: skins[0].name, action: 'keep', conditions: { unknown: 1 } }],
    [{ name: skins[0].name, action: 'keep', conditions: { floatMin: NaN } }],
    [null],
  ];
  for (const rules of variants) {
    let normalized, failure;
    try { normalized = validateOpeningRules(rules, { items: skins }); } catch (error) { failure = error; }
    const result = validateRuleSet(rules, skins);
    assert.equal(result.valid, !failure, JSON.stringify(rules));
    if (!failure) assert.deepEqual(result.rules, normalized);
    else assert(result.errors.length > 0);
  }
});

test('draft parsing keeps false, zero, explicit keep and destination until save', async () => {
  const { ruleDraft, draftRule, validateRuleSet } = await load();
  const source = { id: 'rule-1', name: skins[0].name, action: 'storage', ...storage, accountLabel: 'Other', storageName: 'Archive', conditions: { floatMin: 0, floatMax: 1, statTrak: false, topN: 1 } };
  const draft = ruleDraft(source);
  draft.floatMax = '0.03';
  assert.equal(source.conditions.floatMax, 1, 'typing never mutates persisted rules');
  const updated = draftRule(draft);
  assert.deepEqual(updated.conditions, { floatMin: 0, floatMax: 0.03, statTrak: false, topN: 1 });
  assert.equal(updated.storageName, 'Archive');
  assert.equal(validateRuleSet([updated], skins).valid, true);
  draft.topN = 'nope';
  assert.equal(validateRuleSet([draftRule(draft)], skins).valid, false);
  draft.action = 'keep';
  const kept = draftRule(draft);
  assert.equal(kept.action, 'keep');
  assert.equal(kept.storageUnitId, undefined, 'inactive destination is not sent');
});

test('reordering and replacing rules preserves first-match semantics without mutating the source', async () => {
  const { moveRule, replaceRule, validateRuleSet } = await load();
  const rules = [{ id: 'specific', name: skins[0].name, action: 'keep', conditions: { floatMax: 0.02 } }, { id: 'general', name: skins[0].name, action: 'sell' }];
  assert.deepEqual(moveRule(rules, 0, -1), rules);
  assert.deepEqual(moveRule(rules, 0, 1).map(rule => rule.id), ['general', 'specific']);
  const replaced = replaceRule(rules, 1, { ...rules[1], action: 'keep' });
  assert.equal(rules[1].action, 'sell');
  assert.equal(replaced[0], rules[0]);
  assert.equal(replaced[1].id, 'general');
  assert.equal(validateRuleSet(replaced, skins).valid, true);
});

test('condition summaries expose every active constraint, including negative variants', async () => {
  const { conditionSummary } = await load();
  const summary = conditionSummary({ floatMin: 0, floatMax: 0.03, patterns: ['1', '2'], statTrak: false, souvenir: true, eventName: 'Paris', topN: 10 });
  for (const text of ['0', '0.03', '1, 2', 'StatTrak', 'Souvenir', 'Paris', '10']) assert(summary.includes(text));
  assert.equal(conditionSummary({}), 'Qualquer variante');
});

test('editing an earlier rule cannot duplicate a later rule and existing invalid rows can be repaired individually', async () => {
  const { validateRuleCandidate } = await load();
  const rules = [{ name: skins[0].name, action: 'keep', conditions: { floatMax: 0.02 } }, { name: skins[0].name, action: 'sell' }];
  assert.equal(validateRuleCandidate(rules, 0, { name: skins[0].name, action: 'keep' }, skins).length, 1);
  assert.equal(validateRuleCandidate([...rules, null], 0, rules[0], skins).length, 0);
});

test('malformed saved conditions remain reviewable and unknown constraints are never silently removed', async () => {
  const { ruleDraft, draftRule, validateRuleSet, conditionSummary } = await load();
  const malformed = { name: skins[0].name, action: 'sell', conditions: { unknownConstraint: 1, eventName: 42, statTrak: 'invalid' } };
  assert.doesNotThrow(() => conditionSummary(malformed.conditions));
  const candidate = draftRule(ruleDraft(malformed));
  assert.equal(candidate.conditions.unknownConstraint, 1);
  assert.equal(validateRuleSet([candidate], skins).valid, false);
});

test('unchanged invalid constraints cannot become an unconditional sale through the editor', async () => {
  const { ruleDraft, draftRule, validateRuleSet, patchRuleDraft } = await load();
  for (const conditions of [{ patterns: [] }, { patterns: '42' }, { floatMax: null }, { topN: null }, { eventName: 42 }, { statTrak: null }, null, []]) {
    const source = { name: skins[0].name, action: 'sell', conditions };
    assert.equal(validateRuleSet([source], skins).valid, false);
    assert.equal(validateRuleSet([draftRule(ruleDraft(source))], skins).valid, false, JSON.stringify(conditions));
  }
  const source = { name: skins[0].name, action: 'sell', conditions: { floatMax: null } };
  const explicitlyCleared = patchRuleDraft(ruleDraft(source), { floatMax: '' });
  assert.equal(validateRuleSet([draftRule(explicitlyCleared)], skins).valid, true);
});
