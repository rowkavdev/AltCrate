const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
async function fixture(t){
 const f=await consolidationFixture(t,{noItems:true});
 const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['mint']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 const journal=f.saved(),source=journal.rows[0];
 const isolated={...structuredClone(source),operationId:'isolated-op',accountId:'isolated',sourceLabel:'Isolated',sourceIdentity:'isolated-identity',destinationAccountId:'destination',destinationIdentity:'destination-identity',state:'unconfirmed',stage:'open',message:'Arrival not proven',handoffs:[],remainingItems:[],remainingSkinIds:[],pending:{kind:'seq-open',id:'64d9ecad463b7ffa9697e2ea',before:10,amount:1,skinIds:['c'.repeat(24)]}};
 journal.rows.push(isolated);journal.phase='blocked';
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>journal}});await service.ready();f.requests.length=0;f.commands.length=0;
 const config={action:'sequence',accountIds:['source'],steps:['transfer','convert-received'],destinationAccountId:'destination',resumeOperationIds:[source.operationId]};
 return {...f,journal,isolated,service,config};
}

test('a reviewed continuation can finish on separate accounts while an uncertain local opening stays preserved',async t=>{
 const f=await fixture(t),before=structuredClone(f.isolated),preview=await f.service.prepare(f.config);
 await f.service.start({action:'sequence',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.phase,'blocked');assert.equal(result.rows.find(r=>r.accountId==='source').state,'confirmed');
 assert.equal(f.me.destination.tokens,250);assert.deepEqual(f.saved().rows.find(r=>r.operationId==='isolated-op'),before);
 assert.equal(f.requests.filter(r=>r.accountId==='isolated').length,0);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'||r.path==='/api/casino/tokensToSkins').length,0);
});

test('an uncertain destination opening still blocks continuations that would touch that account',async t=>{
 const f=await fixture(t);f.isolated.accountId='destination';
 await assert.rejects(f.service.prepare(f.config),/pendente|confirmar|isolad|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});

test('an inferred main from the prior run is blocked when that main has an uncertain opening',async t=>{
 const f=await fixture(t);f.journal.rows[0].destinationAccountId='destination';f.journal.rows[0].destinationIdentity='destination-identity';f.isolated.accountId='destination';
 const config={...f.config};delete config.destinationAccountId;
 await assert.rejects(f.service.prepare(config),/pendente|confirmar|isolad|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});

test('another saved session of an uncertain game identity cannot be used as Main',async t=>{
 const f=await fixture(t);f.isolated.sourceIdentity='destination-identity';
 await assert.rejects(f.service.prepare(f.config),/pendente|confirmar|isolad|identidade|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});

test('an uncertain operation without identity correlation conservatively blocks separate continuations',async t=>{
 const f=await fixture(t);delete f.isolated.sourceIdentity;
 await assert.rejects(f.service.prepare(f.config),/pendente|confirmar|isolad|identidade|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});

test('an uncertain transfer blocks both participants even when its source is outside the continuation',async t=>{
 const f=await fixture(t);f.isolated.pending={kind:'inventory-child',childKind:'transfer',accountId:'isolated',itemId:'c'.repeat(24)};
 await assert.rejects(f.service.prepare(f.config),/pendente|confirmar|isolad|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});

test('a fresh run cannot replace a journal containing an isolated uncertain operation',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.prepare({...f.config,resumeOperationIds:[]}),/pendente|confirmar|anterior/i);
 assert.equal(f.saved().rows.length,2);assert.equal(f.saved().rows[1].pending.kind,'seq-open');
});

test('continuation rechecks uncertain participants after review and before starting',async t=>{
 const f=await fixture(t),preview=await f.service.prepare(f.config);
 f.isolated.pending={kind:'inventory-child',childKind:'transfer',accountId:'isolated',itemId:'c'.repeat(24)};
 await assert.rejects(f.service.start({action:'sequence',previewId:preview.previewId}),/pendente|confirmar|isolad|verifica/i);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});
