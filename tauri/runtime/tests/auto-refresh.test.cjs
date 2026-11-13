const test = require('node:test');
const assert = require('node:assert/strict');
const base = '../../casepilot/apps/web/src/';
const now = Date.parse('2026-10-15T12:00:00Z');
const saved = id => ({id, session:{reusable:true}});

test('automatic refresh selects only stale usable accounts and schedules the earliest expiry', async () => {
  const {planOverviewRefresh} = await import(base+'overviewRefresh.js');
  const accounts = [saved('fresh'), saved('old'), saved('unknown'), {id:'pending',session:{reusable:false}}, {id:'verify',session:{reusable:true,validationPending:true}}];
  const snapshots = {fresh:{money:0,observedAt:new Date(now-60000).toISOString()}, old:{tokens:4,observedAt:new Date(now-300000).toISOString()}};
  assert.deepEqual(planOverviewRefresh({accounts,snapshots,now}).targets.map(a=>a.id), ['old','unknown']);
  const next = planOverviewRefresh({accounts:[accounts[0]],snapshots,now});
  assert.equal(next.nextAt,now+240000);
  for (const patch of [{visible:false},{online:false},{busy:true},{running:true},{loading:true},{enabled:false},{paused:true}]) assert.equal(planOverviewRefresh({accounts,snapshots,now,...patch}).targets.length,0);
});
test('automatic refresh waits for shared cooldowns and does not retry access challenges', async () => {
  const {planOverviewRefresh} = await import(base+'overviewRefresh.js');
  const accounts=[saved('a')];
  assert.equal(planOverviewRefresh({accounts,now,cooldownUntil:now+60000}).nextAt,now+60000);
  assert.equal(planOverviewRefresh({accounts,now,refreshStatus:{phase:'paused',errorStatus:429,retryAt:now+120000}}).nextAt,now+120000);
  assert.equal(planOverviewRefresh({accounts,now,refreshStatus:{phase:'paused',errorStatus:429,retryAt:now-1}}).targets.length,1);
  for (const status of [401,403,0]) assert.equal(planOverviewRefresh({accounts,now,refreshStatus:{phase:'paused',errorStatus:status}}).targets.length,0);
  assert.equal(planOverviewRefresh({accounts,now,snapshots:{a:{refreshError:{status:403}}}}).targets.length,0);
  assert.equal(planOverviewRefresh({accounts,now,snapshots:{a:{refreshError:{status:500,at:now-1000}}}}).nextAt,now+299000);
});
test('single-flight reads share success and rejection without caching failures forever', async () => {
  const {createRequestPool}=await import(base+'requestPool.js');
  let release, calls=0, fail=false;
  const read=createRequestPool(async id=>{calls++;await new Promise(resolve=>release=resolve);if(fail)throw Error('Offline');return id;});
  const first=read('a');assert.equal(read('a'),first);await Promise.resolve();assert.equal(calls,1);release();assert.equal(await first,'a');
  fail=true;const second=read('a');assert.equal(read('a'),second);await Promise.resolve();release();await assert.rejects(second,/Offline/);assert.equal(calls,2);
  fail=false;const third=read('a');await Promise.resolve();release();assert.equal(await third,'a');assert.equal(calls,3);
});
test('status polling adapts to activity, pauses while hidden and never overlaps slow reads', async () => {
  const {createStatusPoller}=await import(base+'statusPolling.js');
  let busy=false,visible=true,callback,delay,calls=0,release;
  const poller=createStatusPoller({active:()=>busy,visible:()=>visible,setTimer:(fn,ms)=>{callback=fn;delay=ms;return 1;},clearTimer:()=>{},poll:()=>{calls++;return new Promise(resolve=>release=resolve);}});
  poller.schedule();assert.equal(delay,30000);
  const first=callback();assert.equal(poller.wake(),first);await Promise.resolve();assert.equal(calls,1);busy=true;release();await first;assert.equal(delay,5000);
  visible=false;await callback();assert.equal(calls,1);visible=true;const next=poller.wake();await Promise.resolve();assert.equal(calls,2);poller.stop();release();await next;
});
test('overview sums each account once and retains independent coverage without large temporary arrays', async () => {
  const {overviewReadings}=await import(base+'accountReadState.js');let reads=0;
  const snapshots = new Proxy({a:{money:2,tokens:0,casesTotal:4,observedAt:new Date(now).toISOString()},b:{tokens:3.25},c:{error:'Unavailable'}},{get:(target,key)=>{reads++;return target[key];}});
  const result=overviewReadings([saved('a'),saved('b'),{id:'c',session:{reusable:false}}],snapshots);
  assert.equal(reads,3);assert.equal(result.connected,2);assert.equal(result.read,2);assert.equal(result.failed,1);assert.equal(result.latestAt,now);
  assert.deepEqual(result.fields,{money:{value:2,count:1},tokens:{value:3.25,count:2},casesTotal:{value:4,count:1}});
});
test('account list computes all status counts before applying the selected status', async () => {
  const {accountListView}=await import(base+'accountList.js');
  const accounts=[{...saved('a'),label:'Alpha'},{id:'b',label:'Beta',session:{reusable:false,state:'verification'}},{id:'c',label:'Gamma',session:{reusable:false}}];
  const result=accountListView(accounts,null,{status:'ready'});
  assert.deepEqual(result.rows.map(a=>a.id),['a']);
  assert.deepEqual(result.counts,{all:3,ready:1,pending:2,verification:1});
  assert.deepEqual(accountListView(accounts,null,{query:'Beta',status:'ready'}).counts,{all:1,ready:0,pending:1,verification:1});
});

test('minimizing does not cancel an account refresh already in progress or start a new hidden sweep', async () => {
  const {planOverviewRefresh}=await import(base+'overviewRefresh.js');
  const accounts=[saved('a')];
  assert.equal(planOverviewRefresh({accounts,now,visible:false,refreshStatus:{phase:'running'}}).phase,'reading');
  assert.equal(planOverviewRefresh({accounts,now,visible:false,refreshStatus:{phase:'stopping'}}).phase,'reading');
  const idle=planOverviewRefresh({accounts,now,visible:false,refreshStatus:{phase:'complete'}});
  assert.equal(idle.phase,'inactive');assert.deepEqual(idle.targets,[]);
  assert.equal(planOverviewRefresh({accounts,now,visible:false,busy:true,refreshStatus:{phase:'running'}}).phase,'inactive');
});
