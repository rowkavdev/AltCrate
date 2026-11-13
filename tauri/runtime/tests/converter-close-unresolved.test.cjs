const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const capsule='64d9ecad463b7ffa9697e2ea';
const row=()=>({operationId:'unknown',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',opened:0,sold:0,converted:0,sequencePlan:{selectedSteps:['open']},pending:{kind:'seq-open',id:capsule,before:10,amount:9,skinIds:Array.from({length:9},(_,i)=>(i+100).toString(16).padStart(24,'0'))},verification:{phase:'complete',outcome:'pending',expected:9,found:0,errorStatus:0,finishedAt:'2026-10-17T20:00:00Z',inventory:{page:1,pages:1,read:1,total:1}}});
async function fixture(t,options={}){
 const f=await consolidationFixture(t,options),pending=row();let saved={version:1,rows:[pending]};
 const deps={...f.deps,store:{load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);},archive:async()=>{}}};
 return {...f,pending,deps,service:createTokenConverter(deps),journal:()=>saved};
}
test('explicit closure preserves unknown IDs and counters, survives restart and unlocks all stage selections',async t=>{
 const f=await fixture(t);assert.equal(typeof f.service.closeUnresolved,'function');await f.service.ready();assert.equal(f.service.status().rows[0].canCloseUnresolved,true);
 const result=await f.service.closeUnresolved('unknown'),saved=f.journal().rows[0];assert.equal(result.rows[0].state,'unresolved');assert.equal(result.phase,'idle');assert.equal(result.rows[0].verified,false);assert.equal(saved.opened,0);assert.equal(saved.converted,0);assert.deepEqual(saved.pending,f.pending.pending);assert.equal(saved.resolution.kind,'unresolved-opening');assert.ok(Date.parse(saved.resolution.closedAt));assert.equal(result.rows[0].canVerify,true);assert.equal(result.clearableCount,0);
 const reopened=createTokenConverter(f.deps);await reopened.ready();assert.equal(reopened.status().rows[0].state,'unresolved');assert.deepEqual(f.journal().rows[0].pending,f.pending.pending);
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 for(const step of ['sell','buy','open','convert-stickers','convert-inventory','mint','transfer','convert-received'])assert.deepEqual(converterGuidance({independent:true,status:reopened.status(),steps:[step],sourceIds:['source']}).eligibleSourceIds,['source']);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('a fresh eight-stage route protects late old stickers even if the user includes protected items',async t=>{
 const f=await fixture(t,{cases:1,capsules:1,money:200});await f.service.closeUnresolved('unknown');const id=f.pending.pending.skinIds[0];f.stock.source.push({_id:id,name:'Late old sticker',price:1,isFavorite:false});
 const steps=['sell','buy','open','convert-stickers','convert-inventory','mint','transfer','convert-received'];
 const preview=await f.service.prepare({action:'sequence',independent:true,accountIds:['source'],destinationAccountId:'destination',steps,protectedItemIds:['source:'+id]});
 assert.equal(preview.rows[0].items.some(item=>item.id===id),false);assert.equal(preview.rows[0].excludedItems.some(item=>item.id===id&&item.protection.includes('unresolved-result')),true);
 await f.service.start({action:'sequence',previewId:preview.previewId});await settled(f.service);
 assert.equal(f.journal().rows.find(r=>r.operationId!=='unknown').state,'confirmed');assert.deepEqual(f.journal().rows.find(r=>r.operationId==='unknown').pending,f.pending.pending);assert.equal(f.stock.source.some(item=>item._id===id),true);assert.equal(f.requests.some(r=>r.path==='/api/casino/skinToTokens'&&r.body?.id===id),false);assert.equal(f.commands.some(command=>command.payload?.skinIds?.includes(id)),false);
});
test('incomplete reads, unverified intents and held items cannot be closed through this action',async t=>{
 for(const mutate of [r=>{delete r.verification;},r=>{r.verification.errorStatus=429;},r=>{r.verification.inventory.read=0;},r=>{r.pending.skinIds.pop();},r=>{r.pending.kind='seq-sell';},r=>{r.handoffs=[{id:'a'.repeat(24),kind:'skin',location:'source'}];}]){
  const f=await consolidationFixture(t),pending=row();mutate(pending);const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[pending]})}});
  assert.equal(typeof service.closeUnresolved,'function');await assert.rejects(service.closeUnresolved('unknown'),/verifica|encerrar|identificad|completa/i);assert.equal(service.status().rows[0].state,'unconfirmed');assert.equal(f.requests.some(r=>r.method!=='GET'),false);
 }
});
test('failed closure persistence does not unlock the account or discard the original intent',async t=>{
 const f=await fixture(t),service=createTokenConverter({...f.deps,store:{...f.deps.store,save:async value=>{if(value.rows.some(r=>r.state==='unresolved'))throw Error('disk full');await f.deps.store.save(value);}}});
 await assert.rejects(service.closeUnresolved('unknown'),/disk full/);assert.equal(service.status().rows[0].state,'unconfirmed');assert.deepEqual(service.status().rows[0].lockedAccountIds,['source']);assert.deepEqual(f.journal().rows[0].pending,f.pending.pending);
});
test('later arrival can be verified after new openings change capsule stock, without replaying the old opening',async t=>{
 const f=await fixture(t,{noItems:true,capsules:2});await f.service.closeUnresolved('unknown');
 const preview=await f.service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open']});await f.service.start({action:'sequence',previewId:preview.previewId});await settled(f.service);
 f.stock.source.push(...f.pending.pending.skinIds.map(id=>({_id:id,name:'Late sticker',price:1,isFavorite:false})));
 const result=await f.service.verify('unknown'),old=result.rows.find(r=>r.operationId==='unknown');assert.equal(old.verification.outcome,'confirmed');assert.equal(old.opened,9);assert.equal(old.pendingStickers,9);assert.equal(f.journal().rows.find(r=>r.operationId==='unknown').pending,null);assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);
});
test('a new capsule response cannot recycle a quarantined result into automatic conversion',async t=>{
 const reserved=row().pending.skinIds[0];
 const f=await fixture(t,{noItems:true,capsules:1,beforeRequest:({path,stock,caseStock,body})=>{
  if(path!=='/api/open/capsule')return;caseStock.source[1].amount-=body.count*body.caseOpenMultiplier;
  const item={_id:reserved,name:'Old sticker returned again',price:1,isFavorite:false};stock.source.push(item);return new Response(JSON.stringify([item]));
 }});await f.service.closeUnresolved('unknown');
 const preview=await f.service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open','convert-stickers']});await f.service.start({action:'sequence',previewId:preview.previewId});await settled(f.service);
 assert.equal(f.requests.some(r=>r.path==='/api/casino/skinToTokens'),false);assert.equal(f.stock.source.some(item=>item._id===reserved),true);assert.equal(f.journal().rows.find(r=>r.operationId!=='unknown').opened,0);
});
test('a completed verification can be closed locally even while the site is unavailable',async t=>{
 const f=await fixture(t),service=createTokenConverter({...f.deps,transport:{...f.deps.transport,identity:async()=>{throw Error('offline');}}});
 const result=await service.closeUnresolved('unknown');assert.equal(result.rows[0].state,'unresolved');assert.equal(f.requests.length,0);assert.equal(result.rows[0].verified,false);
});
test('resolving an old record never lets a previously blocked response claim its stickers a second time',async t=>{
 const reserved=row().pending.skinIds[0];
 const f=await fixture(t,{noItems:true,capsules:1,beforeRequest:({path,stock,caseStock})=>{if(path!=='/api/open/capsule')return;caseStock.source[1].amount=0;const item={_id:reserved,name:'Old sticker',price:1,isFavorite:false};stock.source.push(item);return new Response(JSON.stringify([item]));}});
 await f.service.closeUnresolved('unknown');const p=await f.service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 const newer=f.service.status().rows.find(r=>r.operationId!=='unknown');f.stock.source.push(...f.pending.pending.skinIds.slice(1).map(id=>({_id:id,name:'Old sticker',price:1,isFavorite:false})));
 await f.service.verify('unknown');const result=await f.service.verify(newer.operationId);assert.equal(result.rows.find(r=>r.operationId===newer.operationId).state,'unconfirmed');assert.equal(result.rows.find(r=>r.operationId===newer.operationId).opened,0);assert.equal(f.journal().rows.filter(r=>r.handoffs?.some(item=>item.id===reserved)).length,1);assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);
});
