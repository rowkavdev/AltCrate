const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
async function start(f,steps,extra={}){const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps,routing:'selected',...extra});await f.service.start({action:'sequence',previewId:p.previewId});return settled(f.service);}
test('inventory conversion is local and never mints or transfers',async t=>{
 const f=await consolidationFixture(t);const s=await start(f,['convert-inventory']);assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(f.me.source.tokens,300);assert.equal(f.commands.length,0);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,0);
});
test('mint-only preserves identified skins without requiring a destination',async t=>{
 const f=await consolidationFixture(t,{noItems:true});const s=await start(f,['mint']);assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.equal(f.stock.source.length,1);assert.equal(s.rows[0].pendingItems,1);assert.deepEqual(s.rows[0].availableSteps,['transfer','convert-received']);assert.equal(f.commands.length,0);
});
test('mint and transfer leave the received skin in main and never convert it',async t=>{
 const f=await consolidationFixture(t,{noItems:true});const s=await start(f,['mint','transfer'],{destinationAccountId:'destination'});assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.equal(f.stock.destination.length,2);assert.equal(f.me.destination.tokens,50);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,0);
});
test('non-Pro transfer-only sends reviewed existing stock without minting or converting',async t=>{
 const f=await consolidationFixture(t);const s=await start(f,['transfer'],{destinationAccountId:'destination'});assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.equal(f.stock.source.length,0);assert.ok(f.stock.destination.some(i=>i._id===f.originalId));assert.equal(f.me.destination.tokens,50);assert.equal(f.requests.filter(r=>r.path.includes('/api/casino/')&&r.method==='POST').length,0);
});
for(const pro of [false,true])test('all eight selected steps reconcile the full '+(pro?'Pro':'non-Pro')+' route',async t=>{
 const f=await consolidationFixture(t,{money:50,cases:5,pro});
 const steps=['sell','buy','open','convert-stickers','convert-inventory','mint','transfer','convert-received'];
 const s=await start(f,steps,{destinationAccountId:'destination',routing:'auto'});
 assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].sold,5);assert.equal(s.rows[0].bought,4);assert.equal(s.rows[0].opened,4);assert.equal(s.rows[0].pendingItems,0);assert.equal(s.rows[0].pendingStickers,0);assert.equal(f.me.destination.tokens,750);assert.deepEqual(f.stock.destination.map(i=>i._id),[f.mainId]);
 assert.equal(f.commands.filter(c=>c.event==='tradeAddTokens').length,pro?1:0);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,pro?0:1);
});
