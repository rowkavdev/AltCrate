const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../casepilot/apps/web/src/openingRuleEditorModel.js');
const drafts = () => import('../../casepilot/apps/web/src/openingRulesViewModel.js');

test('visual condition groups include saved false, zero and malformed constraints', async () => {
  const { activeConditionGroups } = await load();
  const { ruleDraft } = await drafts();
  assert.deepEqual(activeConditionGroups(ruleDraft({conditions:{floatMax:0,statTrak:false,patterns:[]}})), ['float','patterns','statTrak']);
});
test('adding and removing a condition is an explicit draft edit and preserves other constraints', async () => {
  const { changeConditionGroup } = await load();
  const { ruleDraft, draftRule } = await drafts();
  const initial=ruleDraft({name:'Skin',action:'sell',conditions:{floatMax:0.03,statTrak:false}});
  const removed=changeConditionGroup(initial,'float',false);
  assert.deepEqual(draftRule(removed).conditions,{statTrak:false});
  const added=changeConditionGroup(removed,'float',true);
  assert.deepEqual(draftRule(added).conditions,{floatMin:0,floatMax:1,statTrak:false});
  assert.equal(initial.floatMax,0.03);
});
test('an active empty filter blocks save until filled or explicitly removed', async () => {
  const { conditionGroupErrors, changeConditionGroup } = await load();
  const { ruleDraft } = await drafts();
  const draft=changeConditionGroup(ruleDraft({name:'Skin',action:'sell'}),'patterns',true);
  assert.equal(conditionGroupErrors(draft,['patterns']).length,1);
  assert.deepEqual(conditionGroupErrors(draft,[]),[]);
  assert.deepEqual(conditionGroupErrors({...draft,patterns:'42'},['patterns']),[]);
});
