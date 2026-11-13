const test=require('node:test'),assert=require('node:assert/strict');
let createTokenSkinRoute;try{({createTokenSkinRoute}=require('../engine/tokenSkinRoute.cjs'));}catch{}
const skin={id:'a'.repeat(24),name:'High value skin',price:10,isFavorite:false};
function fixture(options={}){
 let tokens=200,calls=0,polls=0,stopped=false;const journal=[];
 const row={remainingItems:[],mintBatches:[],mintedItems:0},source={id:'source'},destination={id:'main'};
 const done={state:'done',tokens:options.wrongAmount?99:100,created:1,value:10,convertedToMoney:options.money?5:0,...(options.changedJob?{jobId:'different-job'}:{})};
 const api={converterProfile:async()=>({tokens,money:0,inventoryCount:calls?1:0,inventorySize:100}),converterQueueStatus:async()=>({jobs:calls?{'tokens-to-skins':options.running||polls++===0?{state:'running',tokens:100,progress:{created:0,total:1},...(options.changedJob?{jobId:'expected-job'}:{})}:done}:options.busy?{'tokens-to-skins':{state:'queued',tokens:1}}:{}}),convertedTokenSkins:async()=>calls?[options.old?{...skin,id:'b'.repeat(24)}:skin]:options.old?[{...skin,id:'b'.repeat(24)}]:[],convertTokensToSkins:async()=>{calls++;tokens-=100;if(options.lost)throw Error('Lost reply');return {ok:true,status:202,queued:true,skins:[]};}};
 const context={read:async(_a,work)=>work(api),mutate:async(r,_a,pending,work)=>{r.pending=pending;journal.push(structuredClone(r));return work(api);},publish:async r=>{journal.push(structuredClone(r));},check:()=>{if(stopped)throw Error('stopped');},wait:async()=>{if(options.stop)stopped=true;},inventory:async()=>calls?[skin]:[],pollMs:0,timeoutMs:options.running?1:1000};
 return {route:createTokenSkinRoute(),row,source,destination,context,journal,calls:()=>calls,clearStop:()=>{stopped=false;}};
}
test('queued mint records the intention, watches completion and retains exactly the newly created IDs',async()=>{
 const f=fixture();await f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100});
 assert.equal(f.calls(),1);assert.deepEqual(f.row.remainingItems.map(i=>i.id),['a'.repeat(24)]);assert.equal(f.row.pending,null);assert.equal(f.row.mintedItems,1);
 assert.equal(f.journal[0].pending.amount,100);assert.equal(f.journal[0].pending.beforeTokens,200);
});
test('busy queues are refused before sending tokens',async()=>{
 const f=fixture({busy:true});await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100}),/fila|curso/i);assert.equal(f.calls(),0);
});
for(const [label,options] of [['old result',{old:true}],['wrong amount',{wrongAmount:true}],['inventory payout',{money:true}]])test(label+' suspends the route without transferring any IDs',async()=>{
 const f=fixture(options);await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100}));assert.equal(f.row.remainingItems.length,0);assert.ok(f.row.pending);assert.equal(f.calls(),1);
});
test('lost response can only be reconciled by reads and is never resent',async()=>{
 const f=fixture({lost:true});await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100}));assert.ok(f.row.pending);
 await f.route.verifyMint(f.row,f.source,f.context);if(f.row.pending)await f.route.verifyMint(f.row,f.source,f.context);
 assert.equal(f.calls(),1);assert.equal(f.row.pending,null);assert.equal(f.row.remainingItems.length,1);
});
test('stop preserves the pending job and verification after restart does not send another request',async()=>{
 const f=fixture({stop:true});await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100}));assert.ok(f.row.pending);f.clearStop();
 const recovered=createTokenSkinRoute();await recovered.verifyMint(f.row,f.source,f.context);assert.equal(f.calls(),1);assert.equal(f.row.remainingItems.length,1);
});
test('mint rejects amounts beyond the official ceiling before a network mutation',async()=>{
 const f=fixture();for(const amount of [0,1.1,100000001])await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount}));assert.equal(f.calls(),0);
});
test('a different job replacing the observed active job is never accepted as our minted skins',async()=>{
 const f=fixture({changedJob:true});await assert.rejects(f.route.mint(f.row,f.source,f.destination,{...f.context,amount:100}),/trabalho|fila|conversão/i);
 assert.equal(f.row.remainingItems.length,0);assert.ok(f.row.pending);assert.equal(f.calls(),1);
});
