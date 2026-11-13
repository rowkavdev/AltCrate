const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {createJsonStore}=require('../engine/jsonStore.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
async function fixture(t,rows,{retryAt=0,archiveFailure=false,saveFailure=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'converter-clear-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const live=createJsonStore(path.join(dir,'current.json'));await live.save({version:1,phase:'idle',action:'sequence',retryAt,rows});
 const store={load:live.load,save:async value=>{if(saveFailure&&value.rows.length!==rows.length)throw Error('disk full');await live.save(value);},archive:async value=>{if(archiveFailure)throw Error('archive unavailable');await createJsonStore(path.join(dir,'history',value.archiveId+'.json')).save(value);}};
 const service=createTokenConverter({store,listAccounts:async()=>[]});await service.ready();
 return {service,live,dir,store,history:async()=>{let files;try{files=await fs.readdir(path.join(dir,'history'));}catch(e){if(e.code==='ENOENT')return [];throw e;}return Promise.all(files.map(file=>fs.readFile(path.join(dir,'history',file),'utf8').then(JSON.parse)));}};
}
const row=(operationId,state='failed',extra={})=>({operationId,accountId:operationId,sourceLabel:operationId,state,sold:0,verified:false,...extra});

test('clearing previous results archives their exact progress and persists an empty current run',async t=>{
 const rows=[row('done','confirmed',{verified:true,sold:548}),row('failed'),row('stopped')],f=await fixture(t,rows);
 assert.equal(f.service.status().clearableCount,3);await f.service.clear();
 assert.equal(f.service.status().rows.length,0);assert.equal(f.service.status().phase,'idle');
 assert.deepEqual((await f.history())[0].rows,rows);assert.equal((await f.live.load()).rows.length,0);
 const reopened=createTokenConverter({store:f.store});await reopened.ready();assert.equal(reopened.status().rows.length,0);
});

test('clearing a mixed run keeps uncertain intents, unresolved trades and identified items',async t=>{
 const rows=[row('done','confirmed',{verified:true}),row('uncertain','unconfirmed',{pending:{kind:'seq-sell',amount:5}}),row('source','stopped',{handoffs:[{id:'skin',location:'source'}]}),row('main','stopped',{handoffs:[{id:'skin2',location:'destination'}]}),row('stickers','stopped',{remainingSkinIds:['sticker']}),row('items','stopped',{remainingItems:[{id:'item'}]}),row('trade','stopped',{tradeId:'unknown'}),row('failed-intent','failed',{pending:{kind:'create'}})];
 const f=await fixture(t,rows);assert.equal(f.service.status().clearableCount,1);await f.service.clear();
 const saved=await f.live.load();assert.equal(saved.phase,'blocked');assert.deepEqual(saved.rows,rows.slice(1));
 assert.deepEqual((await f.history())[0].rows,[rows[0]]);
});

test('clearing previous results cannot reset the site cooldown',async t=>{
 const until=Date.now()+60000,f=await fixture(t,[row('old')],{retryAt:until});await f.service.clear();
 assert.equal(f.service.status().retryAt,until);await assert.rejects(f.service.start({action:'sell',accountIds:['a']}),e=>e.status===429&&e.retryAt===until);
});

test('archive and current-journal failures leave the active results available',async t=>{
 for(const option of ['archiveFailure','saveFailure']){
  const f=await fixture(t,[row('old')],{[option]:true});await assert.rejects(f.service.clear(),/unavailable|disk full/);
  assert.equal(f.service.status().rows[0].operationId,'old');assert.equal((await f.live.load()).rows[0].operationId,'old');
 }
});

test('a run containing only protected results cannot be cleared',async t=>{
 const f=await fixture(t,[row('pending','unconfirmed',{pending:{kind:'seq-sell'}})]);
 assert.equal(f.service.status().clearableCount,0);await assert.rejects(f.service.clear(),/pendente|limpar/i);assert.equal((await f.history()).length,0);
});

test('clearing is serialized and prevents a new run until the archive is durable',async t=>{
 const f=await fixture(t,[row('old')]);let release,entered;const reached=new Promise(r=>{entered=r;}),archive=f.store.archive;
 f.store.archive=async value=>{entered();await new Promise(r=>{release=r;});await archive(value);};
 const clearing=f.service.clear();await reached;await assert.rejects(f.service.clear(),/curso|execução|aguarda/i);
 await assert.rejects(f.service.start({action:'sell',accountIds:['a']}),/execução/);release();await clearing;assert.equal((await f.history()).length,1);
});

test('clearing invalidates an earlier preview and never sends a new game mutation',async t=>{
 const f=await consolidationFixture(t,{cases:5,noItems:true}),archived=[];
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async value=>archived.push(value)}});
 const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 const preview=await service.prepare({action:'sequence',accountIds:['source'],steps:['buy']}),before=f.requests.filter(r=>r.method!=='GET').length;
 await service.clear();await assert.rejects(service.start({action:'sequence',previewId:preview.previewId}),/expirou|revis/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,before);assert.equal(archived[0].rows[0].sold,5);
});
