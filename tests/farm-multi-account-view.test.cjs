const test = require('node:test');
const assert = require('node:assert/strict');

test('incomplete-case remainder appears waiting until its actual budget reset', async () => {
  const {farmAccountState} = await import('../src/farmViewModel.js');
  const entry = {selected:true,modes:{case:true,money:false,vault:false},budget:{caseUsed:2394,moneyUsed:0,caseClicksAvailable:0,moneyClicksAvailable:0,waitUntil:311000}};
  const state = farmAccountState(entry,{phase:'running'},1000);
  assert.equal(state.key,'waiting');
  assert.equal(state.nextAt,311000);
});

test('one server-limited account appears waiting while another keeps its place in the queue',async()=>{
  const {farmAccountState,farmRunSummary}=await import('../src/farmViewModel.js');
  const a={id:'a',selected:true,modes:{case:true,money:true},budget:{cooldownUntil:61000}};
  const b={id:'b',selected:true,modes:{case:true,money:true},budget:{caseUsed:0,moneyUsed:0,combinedRemaining:1900,cooldownUntil:0}};
  const status={phase:'running',accounts:[a,b],budget:{cooldownUntil:0}};
  assert.equal(farmAccountState(a,status,1000).label,'Limite desta conta');assert.equal(farmAccountState(b,status,1000).key,'queued');
  assert.equal(farmRunSummary(status,1000).waiting,1);assert.equal(farmRunSummary(status,1000).queued,1);
});

test('one exhausted account does not make another account wait',async()=>{
  const {farmAccountState}=await import('../src/farmViewModel.js');
  const spent={id:'a',selected:true,modes:{case:true,money:true},budget:{caseUsed:950,moneyUsed:950,combinedRemaining:0,waitUntil:311000}};
  const ready={id:'b',selected:true,modes:{case:true,money:true},budget:{caseUsed:0,moneyUsed:0,combinedRemaining:1900,waitUntil:0}};
  const status={phase:'running',accounts:[spent,ready],budget:{caseUsed:950,moneyUsed:950,combinedRemaining:1900,waitUntil:311000,cooldownUntil:0}};
  assert.equal(farmAccountState(spent,status,1000).key,'waiting');
  assert.equal(farmAccountState(ready,status,1000).key,'queued');
  status.budget.cooldownUntil=5000;
  assert.equal(farmAccountState(ready,status,1000).key,'waiting');
});

test('only in-flight accounts count as active; ready accounts belong to the queue', async () => {
  const {farmAccountActivity, farmAccountState, filterFarmAccounts} = await import('../src/farmViewModel.js');
  const queued = {id:'a',selected:true,modes:{case:true,money:true,vault:false}};
  const busy = {...queued,id:'b',inFlight:true};
  const status = {phase:'running',budget:{caseUsed:0,moneyUsed:0,combinedRemaining:1900},accounts:[queued,busy]};
  assert.deepEqual(farmAccountActivity(queued,status,1000),{active:false,waiting:false});
  assert.equal(farmAccountState(queued,status,1000).key,'queued');
  assert.equal(farmAccountActivity(busy,status,1000).active,true);
  assert.deepEqual(filterFarmAccounts([{id:'a',label:'A'},{id:'b',label:'B'}],'','active',status).map(a=>a.id),['b']);
});

test('cooldown, retry and vault schedules describe the actual wait instead of farming', async () => {
  const {farmAccountState} = await import('../src/farmViewModel.js');
  const entry = {selected:true,modes:{case:true,money:true,vault:true},vaultNextAt:90000};
  const status = {phase:'running',accounts:[entry],budget:{caseUsed:950,moneyUsed:950,combinedRemaining:0,waitUntil:310000}};
  assert.equal(farmAccountState(entry,status,1000).key,'waiting');
  assert.equal(farmAccountState(entry,status,1000).nextAt,90000);
  assert.equal(farmAccountState(entry,{...status,budget:{...status.budget,cooldownUntil:200000}},1000).nextAt,200000);
  assert.equal(farmAccountState({...entry,retryAt:50000},status,1000).nextAt,50000);
});

test('a case-only account can use its remaining allowance beyond 1900 combined clicks', async () => {
  const {farmAccountState} = await import('../src/farmViewModel.js');
  const entry = {selected:true,modes:{case:true,money:false,vault:false}};
  const status = {phase:'running',accounts:[entry],budget:{caseUsed:2000,moneyUsed:0,caseRemaining:400,combinedRemaining:0,waitUntil:310000}};
  assert.equal(farmAccountState(entry,status,1000).key,'queued');
});

test('run summary totals confirmed results separately and identifies pending confirmations', async () => {
  const {farmRunSummary} = await import('../src/farmViewModel.js');
  const summary = farmRunSummary({accounts:[{results:{case:3,money:2.5,vault:10,unconfirmedRequests:1}},{results:{case:6,money:4,vault:0,unconfirmedRequests:2}}]});
  assert.equal(summary.case,9);assert.equal(summary.money,6.5);assert.equal(summary.vault,10);assert.equal(summary.unconfirmedRequests,3);
});
