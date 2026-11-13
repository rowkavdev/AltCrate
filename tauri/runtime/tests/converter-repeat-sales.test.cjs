const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const capsule='64d9ecad463b7ffa9697e2ea';
const unknown=()=>({operationId:'unknown-open',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',sequencePlan:{selectedSteps:['open']},opened:0,pending:{kind:'seq-open',id:capsule,before:9,amount:9,skinIds:Array.from({length:9},(_,i)=>(i+100).toString(16).padStart(24,'0'))}});
test('ten separately reviewed sales on the same account preserve an unknown opening across restart',async t=>{
 const f=await consolidationFixture(t,{noItems:true}),pending=unknown(),archives=[];let saved={version:1,phase:'blocked',rows:[structuredClone(pending)]};
 const deps={...f.deps,store:{load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);},archive:async value=>archives.push(value)}};
 let service=createTokenConverter(deps);await service.ready();
 for(let n=1;n<=10;n++){
  if(n===6){service=createTokenConverter(deps);await service.ready();}
  f.caseStock.source[0].amount=n;
  const preview=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});
  await service.start({action:'sequence',previewId:preview.previewId});await settled(service);
  assert.deepEqual(saved.rows.find(row=>row.operationId===pending.operationId),pending);
  const sale=saved.rows.find(row=>row.operationId!==pending.operationId);assert.equal(sale.sold,n);assert.equal(sale.state,'confirmed');assert.deepEqual(sale.completedSteps,['sell']);
  assert.equal(saved.rows.length,2);
 }
 assert.deepEqual(f.requests.filter(r=>r.method==='DELETE'&&r.path==='/api/cases').map(r=>r.body.amount),[1,2,3,4,5,6,7,8,9,10]);
 assert.equal(f.requests.some(r=>r.path==='/api/open/capsule'||r.path.startsWith('/api/inventory?')),false);
 assert.equal(archives.length,9);assert.equal(archives.some(a=>a.rows.some(row=>row.operationId===pending.operationId)),false);
 assert.equal(f.commands.length,0);
});
test('an unknown opening explains conflicting stages without excluding the selected account',async t=>{
 const f=await consolidationFixture(t),row=unknown(),service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});await service.ready();
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const sell=converterGuidance({independent:true,steps:['sell'],sourceIds:['source'],status:service.status()});
 assert.deepEqual(sell.eligibleSourceIds,['source']);assert.equal(sell.issues.some(i=>i.blocking!==false),false);
 for(const steps of [['open'],['buy'],['convert-inventory'],['sell','open']]){
  const blocked=converterGuidance({independent:true,steps,sourceIds:['source'],status:service.status()});assert.deepEqual(blocked.eligibleSourceIds,['source']);assert.equal(blocked.issues[0].blocking,true);
  await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['source'],steps}),/confirm|pendente|anterior/);
 }
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('a sale pending confirmation is never repeated through a fresh selection',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:3}),row={...unknown(),pending:{kind:'seq-sell',id:f.caseStock.source[0]._id,before:3,amount:3,beforeMoney:0,maximumCredit:210}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});
 await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']}),/confirm|pendente|anterior/);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('the scope is rechecked when an unknown opening changes to a pending sale before Start',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2}),row=unknown(),service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});
 const preview=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});row.pending={kind:'seq-sell'};
 await assert.rejects(service.start({action:'sequence',previewId:preview.previewId}),/confirm|pendente|anterior/);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('confirmed older stickers can still be continued after a newer sale on that account',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:1}),pending=unknown();let saved={version:1,rows:[pending]};
 const service=createTokenConverter({...f.deps,store:{load:async()=>saved,save:async value=>{saved=structuredClone(value);},archive:async()=>{}}});
 const sale=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});await service.start({action:'sequence',previewId:sale.previewId});await settled(service);
 f.stock.source.push(...pending.pending.skinIds.map(id=>({_id:id,name:'Sticker',price:1,isFavorite:false})));
 await service.verify(pending.operationId);const row=service.status().rows.find(r=>r.operationId===pending.operationId);assert.equal(row.canReviewNext,true);assert.equal(row.canRepeat,true);
 const next=await service.prepare({action:'sequence',accountIds:['source'],steps:['convert-stickers'],resumeOperationIds:[pending.operationId]});await service.start({action:'sequence',previewId:next.previewId});await settled(service);
 assert.equal(f.stock.source.length,0);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,9);assert.equal(f.requests.some(r=>r.path==='/api/open/capsule'),false);
});
test('older held results expose continuation even when independent repetition is also available',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('../../casepilot/apps/web/node_modules/typescript');
 const source=fs.readFileSync(require.resolve('../../casepilot/apps/web/src/pages/TokenConverterPage.jsx'),'utf8');
 const component=source.slice(source.indexOf('function Recovery('),source.indexOf('function RowDetails('));
 const code=ts.transpileModule(component+'\nthis.Recovery=Recovery;',{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const sandbox={React:{createElement:(type,props,...children)=>({type,props:props||{},children})},useState:()=>[false,()=>{}],Button:'button',Square:'icon',ArrowRight:'icon',RefreshCw:'icon',ExternalLink:'icon',t:value=>value};vm.runInNewContext(code,sandbox);
 const row={operationId:'older-open',canRepeat:true,canReviewNext:true,state:'stopped',pendingStickers:9},called=[];
 const tree=sandbox.Recovery({row,bridge:{},onReviewNext:rows=>called.push(rows),onChooseSteps:()=>{throw Error('Must continue the owning operation');}});
 const nodes=[];function visit(node){if(node&&typeof node==='object'){nodes.push(node);for(const child of node.children||[])Array.isArray(child)?child.forEach(visit):visit(child);}}visit(tree);
 const button=nodes.find(node=>node.type==='button'&&node.children.some(child=>child==='Rever próxima etapa'));assert.ok(button,'Continuation must be reachable for the older owning row');button.props.onClick();assert.equal(called[0][0],row);
});
