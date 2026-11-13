const test=require('node:test'),assert=require('node:assert/strict');
const {loadComponent,render}=require('./helpers/render.cjs');
const load=()=>import('../src/pages/claimAllRewards.js');
const row=(kind,payload,eligible=true)=>({accountId:'a',kind,payload,eligible});
test('claim all includes every eligible type and collects subsequently unlocked rewards',async()=>{
 const {claimAllRewards}=await load();let scans=0;const actions=[];
 const first=[row('reward',{id:1.25}),row('mission',{id:'day'}),row('mission',{id:'week'}),row('pass',{tier:1,track:'free'}),row('pass',{tier:1,track:'premium'}),row('reward',{id:9},false)];
 const bridge={discoverProgressionBatch:async input=>{assert.deepEqual(input,{accountIds:['a'],kinds:['reward','mission','pass']});return ++scans===1?first:scans===2?[first[0],row('reward',{id:2.25}),row('pass',{tier:2,track:'free'})]:[];},prepareProgressionBatch:async value=>{actions.push(value.actions);return {batchId:String(actions.length),rows:value.actions.map(()=>({state:'ready'}))};},confirmProgressionBatch:async()=>({phase:'completed',rows:actions.at(-1).map(()=>({state:'confirmed'}))})};
 const result=await claimAllRewards({bridge,accountIds:['a']});assert.equal(result.confirmed,7);assert.deepEqual(actions[0],first.slice(0,5).map(({accountId,kind,payload})=>({accountId,kind,payload})));assert.equal(actions[1].length,2);
});
test('claim all halts on unconfirmed or failed results without a new scan',async()=>{
 const {claimAllRewards}=await load();for(const state of ['unconfirmed','failed']){let scans=0;const bridge={discoverProgressionBatch:async()=>{scans++;return [row('reward',{id:1})];},prepareProgressionBatch:async()=>({batchId:'b',rows:[{state:'ready'}]}),confirmProgressionBatch:async()=>({phase:state==='unconfirmed'?'blocked':'stopped',rows:[{state}]})};const r=await claimAllRewards({bridge,accountIds:['a']});assert.equal(scans,1);assert.equal(r.batch.rows[0].state,state);}
});
test('stopping during discovery or preparation never confirms an action',async()=>{
 const {claimAllRewards}=await load();for(const stage of ['read','prepare']){let stopped=false,confirmed=0,cancelled=0;const bridge={discoverProgressionBatch:async()=>{if(stage==='read')stopped=true;return [row('reward',{id:1})];},prepareProgressionBatch:async()=>{stopped=true;return {batchId:'b',rows:[{state:'ready'}]};},confirmProgressionBatch:async()=>{confirmed++;},stopProgressionBatch:async()=>{cancelled++;}};await claimAllRewards({bridge,accountIds:['a'],shouldStop:()=>stopped});assert.equal(confirmed,0);assert.equal(cancelled,stage==='prepare'?1:0);}
});
test('empty discovery sends nothing and unavailable preparations are not confirmed',async()=>{
 const {claimAllRewards}=await load();let prepares=0,confirms=0;for(const rows of [[],[row('reward',{id:1})]]){const r=await claimAllRewards({bridge:{discoverProgressionBatch:async()=>rows,prepareProgressionBatch:async()=>{prepares++;return {batchId:'b',rows:[{state:'unavailable'}]};},confirmProgressionBatch:async()=>{confirms++;}},accountIds:['a']});assert.equal(r.confirmed,0);}assert.equal(prepares,1);assert.equal(confirms,0);
});
test('a failed discovery is reported instead of claiming no rewards are available',async()=>{
 const {claimAllRewards}=await load();await assert.rejects(claimAllRewards({bridge:{discoverProgressionBatch:async()=>[{kind:'read',state:'failed',message:'Consulta indisponível'}]},accountIds:['a']}),/Consulta indisponível/);
});
test('Rewards presents the one-click claim button with the current scope and locks it without accounts',async()=>{
 const Panel=await loadComponent('/src/pages/ProgressionBatchPanel.jsx');const bridge={prepareProgressionBatch(){},discoverProgressionBatch(){},confirmProgressionBatch(){}};
 const html=render(Panel,{model:{bridge,accounts:[{id:'a',label:'Conta A'}],selectedIds:['a']},accountId:'a'});assert.match(html,/Resgatar todas/);assert.match(html,/Conta A/);
 const empty=render(Panel,{model:{bridge,accounts:[],selectedIds:[]}});assert.match(empty,/disabled=""[^>]*>Resgatar todas/);
 const skills=render(Panel,{model:{bridge,accounts:[],selectedIds:[]},mode:'skills'});assert.doesNotMatch(skills,/Resgatar todas/);
});
