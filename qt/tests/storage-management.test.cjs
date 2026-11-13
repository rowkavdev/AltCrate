const test=require('node:test'),assert=require('node:assert/strict');
const {createStorageManagement}=require('../engine/storageManagement.cjs');
const {createCaseApi}=require('../engine/api.cjs');
const {createAccountQueue}=require('../engine/accountQueue.cjs');
const id='a'.repeat(24),skin='b'.repeat(24),created='c'.repeat(24);
function fixture(options={}){
 let saved=null,identity='owner',units=[{id,name:'Azul',count:1,index:0,skinIconUrl:'original-icon'}],inventory=new Set();const calls=[];
 const reader={list:async()=>structuredClone(units),read:async()=>({pages:1,skins:units[0]?.count?[{id:skin}]:[]})};
 const deps={reader,listAccounts:async()=>[{id:'account',label:'Principal'}],accountQueue:createAccountQueue(),locator:{identity:async()=>identity,scan:async(_a,s)=>({outcome:inventory.has(s)?'found':'absent'})},store:{load:async()=>saved,save:async value=>{if(options.persistFail)throw Error('Disk full');saved=structuredClone(value);}},apiForAccount:()=>createCaseApi(async(endpoint,init)=>{
  const body=JSON.parse(init.body);calls.push({endpoint,method:init.method,body});
  if(options.reject)return {ok:false,status:429,headers:new Headers({'Retry-After':'60'}),text:async()=>JSON.stringify({error:'Limit'})};
  if(init.method==='POST')units.push({id:created,name:'Storage Unit',count:0,index:body.index});
  if(init.method==='PATCH')units[0].name=body.name;
  if(init.method==='DELETE'){if(!options.missingReturn)inventory.add(skin);if(body.clear)units[0].count=0;else units=units.filter(u=>u.id!==body.storageUnitId);}
  if(options.timeout)throw Error('Timeout after send');
  return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({})};
 })};
 return {deps,service:createStorageManagement(deps),calls,replaceIdentity:()=>identity='other',changeCount:()=>units[0].count=2,returnSkin:()=>inventory.add(skin)};
}
const request=kind=>({kind,accountId:'account',storageUnitId:id,name:'Novo nome'});
test('storage contracts serialize create index, rename icon and explicit clear/delete boolean',async()=>{
 for(const kind of ['create','rename','clear','delete']){
  const f=fixture(),p=await f.service.prepare(request(kind));assert.equal(f.calls.length,0);const result=await f.service.confirm(p.previewId);assert.equal(result.state,'confirmed');assert.equal(result.verified,true);
  const call=f.calls[0];assert.equal(call.endpoint,'/api/inventory/storageUnits');
  if(kind==='create')assert.deepEqual(call.body,{index:1});
  if(kind==='rename')assert.deepEqual(call.body,{name:'Novo nome',skinIconUrl:'original-icon',storageUnitId:id});
  if(['clear','delete'].includes(kind))assert.deepEqual(call.body,{clear:kind==='clear',storageUnitId:id});
  await f.service.confirm(p.previewId);assert.equal(f.calls.length,1);
 }
});
test('delete and clear require each reviewed skin to arrive in original inventory',async()=>{
 for(const kind of ['delete','clear']){const f=fixture({missingReturn:true}),p=await f.service.prepare(request(kind));assert.equal((await f.service.confirm(p.previewId)).state,'unconfirmed');f.returnSkin();assert.equal((await f.service.verify((await f.service.list())[0].operationId)).state,'confirmed');assert.equal(f.calls.length,1);}
});
test('timeout reconciliation after restart does not replay storage mutation',async()=>{
 const f=fixture({timeout:true}),p=await f.service.prepare(request('create')),result=await f.service.confirm(p.previewId);assert.equal(result.state,'unconfirmed');
 const restarted=createStorageManagement(f.deps);await restarted.list();assert.equal(restarted.hasPending(),true);assert.equal((await restarted.verify(result.operationId)).state,'confirmed');assert.equal(f.calls.length,1);assert.equal(restarted.hasPending(),false);
});
test('changed identity or contents blocks reviewed deletion before any mutation',async()=>{
 for(const change of ['replaceIdentity','changeCount']){const f=fixture(),p=await f.service.prepare(request('delete'));f[change]();await assert.rejects(f.service.confirm(p.previewId),/mudou|conteúdo/);assert.equal(f.calls.length,0);}
});
test('invalid account, IDs and name cannot submit requests',async()=>{
 const f=fixture();for(const input of [{...request('rename'),name:'x'.repeat(21)},{...request('delete'),storageUnitId:'invalid'},{...request('create'),accountId:'missing'}])await assert.rejects(f.service.prepare(input));assert.equal(f.calls.length,0);
});
test('journal save failure prevents storage mutation',async()=>{
 const f=fixture({persistFail:true}),p=await f.service.prepare(request('delete'));await assert.rejects(f.service.confirm(p.previewId),/Disk full/);assert.equal(f.calls.length,0);
});
test('pending storage changes require verification and retain identity privately',async()=>{
 const f=fixture({timeout:true}),p=await f.service.prepare(request('rename'));assert.equal(Object.hasOwn(p,'identity'),false);const r=await f.service.confirm(p.previewId);await assert.rejects(f.service.prepare(request('create')),/confirmar/);assert.equal(Object.hasOwn(r,'identity'),false);f.replaceIdentity();const verified=await f.service.verify(r.operationId);assert.equal(verified.state,'unconfirmed');assert.match(verified.message,/identidade/);assert.equal(f.calls.length,1);
});
test('HTTP 429 publishes failure and shared cooldown without retry',async()=>{
 const f=fixture({reject:true});let until=0;f.deps.coordinator={cooldown:async()=>0,limit:async value=>until=value};const s=createStorageManagement(f.deps),p=await s.prepare(request('create'));assert.equal((await s.confirm(p.previewId)).state,'failed');assert.ok(until>Date.now());assert.equal(f.calls.length,1);
});
