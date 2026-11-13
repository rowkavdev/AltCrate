const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createConverterJournalStore}=require('../engine/converterJournalStore.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'converter-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'token-converter.json')};}
const state=()=>({version:1,phase:'running',rows:[{operationId:'op-a',accountId:'a',state:'running',pending:{kind:'convert',itemId:'x'},sequencePlan:{items:[{id:'x',name:'reviewed',price:10}],scopes:{tokens:200},tokenBudget:200},handoffs:[]},{operationId:'op-b',accountId:'b',state:'unresolved',resolution:{kind:'unresolved-opening'},sequencePlan:{items:[{id:'y'}],tokenBudget:5}}]});
test('journal migrates legacy state atomically and reconstructs complete plans on restart',async t=>{const {file}=await fixture(t),original=state();await fs.writeFile(file,JSON.stringify(original));const store=createConverterJournalStore(file);assert.deepEqual(await store.load(),original);await store.save(store.capture(original));const disk=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(disk.version,2);assert.equal(disk.rows[0].sequencePlan,undefined);assert.deepEqual(await createConverterJournalStore(file).load(),original);});
test('hot checkpoints snapshot only changed row and keep reviewed plans out of serialized state',async t=>{const {file}=await fixture(t),value=state();value.rows[0].sequencePlan.items=Array.from({length:4000},(_,i)=>({id:String(i),name:'item'.repeat(80),price:i}));const store=createConverterJournalStore(file);await store.save(store.capture(value));value.rows[0].sequencePlan.tokenBudget=999;const captured=store.capture(value,{row:value.rows[0]});assert.equal(captured.changes.length,1);assert.equal(captured.plans.length,0);assert.ok(JSON.stringify(captured).length<5000);value.rows[0].pending.itemId='later';value.rows[0].sequencePlan.tokenBudget=1234;await store.save(captured);const restored=await createConverterJournalStore(file).load();assert.equal(restored.rows[0].pending.itemId,'x');assert.equal(restored.rows[0].sequencePlan.tokenBudget,999);assert.equal(restored.rows[0].sequencePlan.items.length,4000);assert.deepEqual(restored.rows[1],value.rows[1]);});
test('new reviewed plan replaces the old plan without aliasing its captured contents',async t=>{const {file}=await fixture(t),value=state(),store=createConverterJournalStore(file);await store.save(store.capture(value));value.rows[0].sequencePlan={...value.rows[0].sequencePlan,items:[{id:'replacement',price:3}]};const capture=store.capture(value,{row:value.rows[0]});assert.equal(capture.plans.length,1);value.rows[0].sequencePlan.items[0].price=4;await store.save(capture);assert.equal((await store.load()).rows[0].sequencePlan.items[0].price,3);});
test('serialized writes retain all rows and a failed manifest cannot erase acknowledged intent',async t=>{const {file,dir}=await fixture(t),value=state(),store=createConverterJournalStore(file);await store.save(store.capture(value));value.rows[0].pending={kind:'trade',tradeId:'reviewed-trade'};const first=store.capture(value,{row:value.rows[0]});value.rows[1].message='retained';const second=store.capture(value,{row:value.rows[1]});await Promise.all([store.save(first),store.save(second)]);assert.equal((await store.load()).rows[0].pending.tradeId,'reviewed-trade');assert.equal((await store.load()).rows[1].message,'retained');await fs.rename(file,file+'.previous');await fs.mkdir(file);value.rows[0].pending={kind:'new-intent'};await assert.rejects(store.save(store.capture(value,{row:value.rows[0]})));await fs.rmdir(file);await fs.rename(file+'.previous',file);assert.equal((await store.load()).rows[0].pending.kind,'trade');assert.equal((await fs.stat(dir)).isDirectory(),true);});
test('missing or corrupted immutable plan fails closed rather than discarding protected data',async t=>{const {file}=await fixture(t),store=createConverterJournalStore(file);await store.save(store.capture(state()));const plans=await fs.readdir(file+'.d');const plan=plans.find(name=>name.startsWith('plan-'));await fs.writeFile(path.join(file+'.d',plan),'{}');await assert.rejects(createConverterJournalStore(file).load(),/plano|integridade/i);});

test('obsolete hot progress snapshots are reclaimed while queued snapshots stay restartable',async t=>{const {file}=await fixture(t),store=createConverterJournalStore(file),value=state();await store.save(store.capture(value));const saves=[];for(let i=0;i<12;i++){value.rows[0].message='progress '+i;saves.push(store.save(store.capture(value,{row:value.rows[0]})));}await Promise.all(saves);assert.equal((await store.load()).rows[0].message,'progress 11');const names=await fs.readdir(file+'.d');assert.equal(names.filter(name=>name.startsWith('row-')).length,2);});

test('converter checkpoints use bounded store captures before dispatch and survive engine restart',async t=>{
 const {file}=await fixture(t),{consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs'),{createTokenConverter}=require('../engine/tokenConverter.cjs');
 const f=await consolidationFixture(t,{pro:true,noItems:true}),store=createConverterJournalStore(file);let captures=0;
 const service=createTokenConverter({...f.deps,store:{...store,capture(...args){captures++;return store.capture(...args);}}});
 const preview=await service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['transfer']});
 await service.start({action:'sequence',previewId:preview.previewId});const done=await settled(service);
 assert.equal(done.rows[0].state,'confirmed');assert.ok(captures>3);const journal=await store.load();assert.equal(journal.rows[0].transferConfirmed,true);
 const recovered=createTokenConverter({...f.deps,store:createConverterJournalStore(file)});await recovered.ready();assert.equal(recovered.status().rows[0].state,'confirmed');assert.equal(recovered.status().sentTokens,done.sentTokens);
});

test('captured checkpoints retain their artifacts before a delayed save enters the writer queue',async t=>{
 const {file}=await fixture(t),store=createConverterJournalStore(file),value=state();
 value.rows[0].message='X';await store.save(store.capture(value));
 value.rows[0].message='Y';const writingY=store.save(store.capture(value,{row:value.rows[0]}));
 value.rows[0].message='X';const capturedX=store.capture(value,{row:value.rows[0]});
 value.rows[0].message='Z';const capturedZ=store.capture(value,{row:value.rows[0]});
 await writingY;await store.save(capturedX);assert.equal((await store.load()).rows[0].message,'X');
 await store.save(capturedZ);assert.equal((await store.load()).rows[0].message,'Z');
});
test('replaced immutable plans are reclaimed with obsolete progress while live protected plans survive',async t=>{
 const {file}=await fixture(t),store=createConverterJournalStore(file),value=state();await store.save(store.capture(value));
 for(let i=0;i<12;i++){value.rows[0].sequencePlan={items:[{id:'review '+i}],tokenBudget:i};await store.save(store.capture(value,{row:value.rows[0]}));}
 const names=await fs.readdir(file+'.d');assert.equal(names.filter(name=>name.startsWith('plan-')).length,2);assert.equal((await store.load()).rows[1].sequencePlan.items[0].id,'y');
});
test('artifact and manifest renames sync their directories before publication is acknowledged',async t=>{
 const {file}=await fixture(t),events=[];
 const fileSystem={...fs,async rename(from,to){events.push(['rename',to]);return fs.rename(from,to);},async open(name,...args){const handle=await fs.open(name,...args);return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{events.push(['sync',name]);return target.sync();};const result=target[key];return typeof result==='function'?result.bind(target):result;}});}};
 const store=createConverterJournalStore(file,{fileSystem});await store.save(store.capture(state()));
 const renamed=events.filter(event=>event[0]==='rename');assert.ok(renamed.length>=5);
 for(const event of renamed){const at=events.indexOf(event);assert.deepEqual(events[at+1],['sync',path.dirname(event[1])]);}
 assert.deepEqual(events.at(-1),['sync',path.dirname(file)]);
});

test('a capture racing asynchronous row cleanup restores its content for the queued writer',async t=>{
 const {file}=await fixture(t);let armed=false,entered,release;
 const deleting=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const fileSystem={...fs,async unlink(name){if(armed&&path.basename(name).startsWith('row-')){armed=false;entered();await resume;}return fs.unlink(name);}};
 const store=createConverterJournalStore(file,{fileSystem}),value=state();value.rows[0].message='X';await store.save(store.capture(value));
 armed=true;value.rows[0].message='Y';const saving=store.save(store.capture(value,{row:value.rows[0]}));await deleting;
 value.rows[0].message='X';const captured=store.capture(value,{row:value.rows[0]});release();await saving;await store.save(captured);
 assert.equal((await store.load()).rows[0].message,'X');
});
test('a capture racing asynchronous plan cleanup restores the reused plan for the queued writer',async t=>{
 const {file}=await fixture(t);let armed=false,entered,release;
 const deleting=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const fileSystem={...fs,async unlink(name){if(armed&&path.basename(name).startsWith('plan-')){armed=false;entered();await resume;}return fs.unlink(name);}};
 const store=createConverterJournalStore(file,{fileSystem}),value=state(),oldPlan=value.rows[0].sequencePlan;await store.save(store.capture(value));
 armed=true;value.rows[0].sequencePlan={items:[{id:'new-plan'}],tokenBudget:1};const saving=store.save(store.capture(value,{row:value.rows[0]}));await deleting;
 value.rows[0].sequencePlan=oldPlan;const captured=store.capture(value,{row:value.rows[0]});release();await saving;await store.save(captured);
 assert.equal((await store.load()).rows[0].sequencePlan.items[0].id,'x');
});

test('uncertain manifest directory sync failure never deletes the installed manifest dependencies',async t=>{
 const {file}=await fixture(t);let armed=false;
 const fileSystem={...fs,async open(name,...args){const handle=await fs.open(name,...args);if(name!==path.dirname(file))return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{if(armed){armed=false;throw Error('directory sync failed');}return target.sync();};const result=target[key];return typeof result==='function'?result.bind(target):result;}});}};
 const store=createConverterJournalStore(file,{fileSystem}),value=state();value.rows[0].message='X';await store.save(store.capture(value));
 armed=true;value.rows[0].message='Y';const saving=store.save(store.capture(value,{row:value.rows[0]}));value.rows[0].message='Z';const later=store.capture(value,{row:value.rows[0]});
 await assert.rejects(saving,/directory sync failed/);assert.equal((await createConverterJournalStore(file).load()).rows[0].message,'Y');await store.save(later);assert.equal((await store.load()).rows[0].message,'Z');
});
