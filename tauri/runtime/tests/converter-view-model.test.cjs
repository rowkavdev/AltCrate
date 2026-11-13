const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../casepilot/apps/web/src/converterViewModel.js');
const accounts=Array.from({length:25},(_,i)=>({id:'a'+i,label:i===2?'Conta João':'Conta '+i}));
const now=Date.parse('2026-10-16T12:00:00Z');
const snapshots={a0:{tokens:100,membership:'pro',observedAt:'2026-10-16T12:00:00Z'},a1:{tokens:50,membership:'free',observedAt:'2026-10-16T12:00:00Z'},a2:{tokens:12,membership:'basic',observedAt:'2026-10-16T12:00:00Z'},a3:{membership:'pro',observedAt:'2026-10-16T11:00:00Z'},a4:{membership:'pro',error:'failed'}};
test('converter pagination preserves selected accounts outside the current page and excludes the main only for transfer actions',async()=>{
 const {converterViewModel}=await load(),base={accounts,snapshots,selectedIds:['a0','a1','a21'],destinationAccountId:'a0',page:2,pageSize:10,now};
 const view=converterViewModel(base);assert.equal(view.rows.length,10);assert.equal(view.page,2);assert.equal(view.pages,3);assert.deepEqual(view.sourceIds,['a1','a21']);assert.equal(view.totals.selected,2);
 assert.deepEqual(converterViewModel({...base,transfer:false}).sourceIds,['a0','a1','a21']);
});
test('membership filters recognize free and basic but never classify stale/error/missing data as free',async()=>{
 const {converterViewModel}=await load(),base={accounts,snapshots,selectedIds:['a0','a1','a2'],now};
 assert.deepEqual(converterViewModel({...base,membershipFilter:'free'}).rows.map(r=>r.id),['a1','a2']);
 assert.deepEqual(converterViewModel({...base,membershipFilter:'pro'}).rows.map(r=>r.id),['a0']);
 assert.equal(converterViewModel({...base,membershipFilter:'unknown'}).filteredCount,22);
 assert.equal(converterViewModel(base).totals.tokens,162);
});
test('accent-insensitive search and an out-of-range page return the matching visible account',async()=>{
 const {converterViewModel}=await load(),view=converterViewModel({accounts,snapshots,selectedIds:[],query:'joao',page:9,now});
 assert.equal(view.page,1);assert.equal(view.rows[0].id,'a2');assert.equal(view.filteredCount,1);
});
test('step summaries support one, two or eight steps and require main only when needed',async()=>{
 const {converterStepSelection}=await load();
 assert.equal(converterStepSelection({steps:['sell']}).count,1);assert.equal(converterStepSelection({steps:['sell','buy']}).needsDestination,false);
 assert.equal(converterStepSelection({steps:['transfer']}).needsDestination,true);
 assert.equal(converterStepSelection({steps:['sell','buy','open','convert-stickers','convert-inventory','mint','transfer','convert-received']}).count,8);
 assert.deepEqual(converterStepSelection({legacyAction:'open'}).steps,['open','convert-stickers']);
});
test('changing steps, routing, destination or continuation invalidates the sequence scope',async()=>{
 const {converterSequenceScope}=await load(),base={sourceIds:['a'],steps:['mint'],routing:'selected'};
 const before=converterSequenceScope(base);for(const patch of [{steps:['mint','transfer']},{routing:'auto'},{destinationAccountId:'main'},{resumeOperationIds:['op']}])assert.notEqual(converterSequenceScope({...base,...patch}),before);
});
test('a transient refresh failure preserves the last observed membership without treating it as current verification',async()=>{
 const {converterViewModel}=await load(),view=converterViewModel({accounts:[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'}],snapshots:{a:{membership:'free',observedAt:'2026-10-16T12:00:00Z',refreshError:'HTTP 429'},b:{membership:'pro',observedAt:'2026-10-16T11:00:00Z'},c:{membership:'pro',error:'HTTP 429'}},now});
 assert.equal(view.rows[0].membership,'unknown');assert.equal(view.rows[0].observedMembership,'free');assert.equal(view.rows[0].membershipStale,true);
 assert.equal(view.rows[1].membership,'unknown');assert.equal(view.rows[1].observedMembership,'pro');assert.equal(view.rows[1].membershipStale,true);
 assert.equal(view.rows[2].observedMembership,'unknown');assert.equal(view.rows[2].membershipStale,false);
});
