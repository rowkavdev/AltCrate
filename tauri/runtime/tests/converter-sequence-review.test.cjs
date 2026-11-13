const test=require('node:test'),assert=require('node:assert/strict');
let normalizeSequenceSteps,createSequenceReview;
try{({normalizeSequenceSteps}=require('../engine/converterSequenceSteps.cjs'));}catch{}
try{({createSequenceReview}=require('../engine/converterSequenceReview.cjs'));}catch{}
const id=n=>n.toString(16).padStart(24,'0');
function fixture(){
 const accounts=['source','main'].map(id=>({id,label:id})),items={source:[{id:id(1),name:'Ordinary',price:2,isFavorite:false},{id:id(2),name:'Favorite',price:3,isFavorite:true}],main:[]};
 const profiles={source:{membership:'free',tokens:100,money:200,rank:20,inventoryCount:2,inventorySize:100,dailyTradesLeft:0},main:{membership:'pro',tokens:0,money:0,inventoryCount:0,inventorySize:100,dailyTradesLeft:100}},calls=[];
 let run={rows:[]},now=1000;
 const deps={listAccounts:async()=>accounts,readRun:()=>run,now:()=>now,read:async(a,work)=>work({converterProfile:async()=>({...profiles[a.id],inventoryCount:items[a.id].length}),converterOpeningConfiguration:async()=>({config:{autosellActivated:false,autosellAmount:0,autosellVariant:'money'}}),tradingStatus:async()=>{calls.push('trading:'+a.id);return {isUnlocked:profiles[a.id].dailyTradesLeft>0};},converterCasePrices:async()=>[{id:id(5),price:70}],converterCases:async()=>[{id:id(5),type:'case',amount:3},{id:'64d9ecad463b7ffa9697e2ea',type:'capsule',amount:2}],converterCapsule:async()=>({id:'64d9ecad463b7ffa9697e2ea',price:100,rankNeeded:11})}),locator:{identity:async a=>a+'-identity'},readInventory:async a=>({skins:items[a],pages:1,count:items[a].length})};
 return {service:createSequenceReview(deps),items,profiles,calls,setRun:value=>{run=value},advance:ms=>{now+=ms}};
}
const cfg=steps=>({action:'sequence',accountIds:['source'],steps,routing:'selected'});
test('step selection is canonical and rejects empty, duplicated or unknown steps',()=>{
 assert.deepEqual(normalizeSequenceSteps(['buy','sell']),['sell','buy']);
 for(const value of [[],['mint','mint'],['unknown'],null])assert.throws(()=>normalizeSequenceSteps(value));
});
test('local inventory review requires neither main nor unlocked trading',async()=>{
 const f=fixture(),p=await f.service.prepare(cfg(['convert-inventory']));
 assert.equal(p.destination,null);assert.deepEqual(p.rows[0].effectiveSteps,['convert-inventory']);assert.equal(p.rows[0].items.length,1);assert.deepEqual(f.calls,[]);
 const plan=await f.service.consume(p.previewId);assert.equal(plan.rows[0].sourceIdentity,'source-identity');await assert.rejects(f.service.consume(p.previewId));
});
test('mint-only review checks source space without requiring a main or trading',async()=>{
 const f=fixture(),p=await f.service.prepare(cfg(['mint']));assert.equal(p.destination,null);assert.equal(p.rows[0].route,'skins');assert.equal(p.rows[0].items.length,0);assert.deepEqual(f.calls,[]);
 f.profiles.source.inventorySize=2;await assert.rejects(f.service.prepare(cfg(['mint'])),/espaço|cheio/i);
});
test('non-Pro transfer reviews exact existing stock and excludes favorite skins',async()=>{
 const f=fixture();f.profiles.source.dailyTradesLeft=100;
 const p=await f.service.prepare({...cfg(['transfer']),destinationAccountId:'main'});
 assert.deepEqual(p.rows[0].transferItems.map(i=>i.id),[id(1)]);assert.equal(p.rows[0].excludedItems[0].isFavorite,true);
});
test('incompatible non-Pro inventory plus token sending is refused before mutation',async()=>{
 const f=fixture();f.profiles.source.dailyTradesLeft=100;
 await assert.rejects(f.service.prepare({...cfg(['convert-inventory','transfer']),destinationAccountId:'main'}),/criar|mint|skins/i);
 await assert.rejects(f.service.prepare({...cfg(['convert-received']),destinationAccountId:'main'}),/recebid|identific|anterior/i);
});
test('auto full route shows explicit Pro omissions, while selected mint plus transfer keeps the skin route',async()=>{
 const f=fixture();f.profiles.source.membership='pro';f.profiles.source.dailyTradesLeft=100;
 const config={...cfg(['mint','transfer','convert-received']),destinationAccountId:'main'};
 const a=await f.service.prepare({...config,routing:'auto'});assert.deepEqual(a.rows[0].effectiveSteps,['transfer']);assert.equal(a.rows[0].route,'tokens');
 const b=await f.service.prepare(config);assert.deepEqual(b.rows[0].effectiveSteps,config.steps);assert.equal(b.rows[0].route,'skins');
});
test('continuation only converts proven destination handoffs and locks their main identity',async()=>{
 const f=fixture();f.items.main=[{id:id(7),name:'Received',price:20,isFavorite:false}];
 f.setRun({rows:[{operationId:'op',accountId:'source',sourceIdentity:'source-identity',destinationAccountId:'main',destinationIdentity:'main-identity',state:'paused',sequencePlan:{version:1},completedSteps:['mint','transfer'],handoffs:[{...f.items.main[0],location:'destination',kind:'skin',ref:{accountId:'main',itemId:id(7),storageUnitId:null}}]}]});
 const p=await f.service.prepare({...cfg(['convert-received']),resumeOperationIds:['op'],destinationAccountId:'main'});
 assert.deepEqual(p.rows[0].receivedItems.map(i=>i.id),[id(7)]);assert.equal(p.rows[0].resumeOperationId,'op');
 await assert.rejects(f.service.prepare({...cfg(['convert-received']),resumeOperationIds:['op'],destinationAccountId:'source'}),/principal|destino|diferente/i);
 f.items.main[0].price=999;await assert.rejects(f.service.consume(p.previewId),/mud|rev/i);
});
test('capsule review binds quantities and budget and refuses changed resources and expired previews',async()=>{
 const f=fixture(),p=await f.service.prepare(cfg(['sell','buy','open']));
 assert.equal(p.rows[0].scopes.cases[0].amount,3);assert.equal(p.rows[0].scopes.money,200);
 f.profiles.source.money=300;await assert.rejects(f.service.consume(p.previewId),/mud|rev/i);
 const q=await f.service.prepare(cfg(['sell']));f.advance(300001);await assert.rejects(f.service.consume(q.previewId),/expir/i);
});
