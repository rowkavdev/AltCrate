const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../../casepilot/apps/web/src/inventorySelection.js');
test('page selection preserves other accounts, deduplicates IDs and respects the 200 item limit',async()=>{
 const {selectInventoryPage}=await load();
 const old=Array.from({length:199},(_,i)=>({key:'other:'+i,ref:{accountId:'other',itemId:String(i)},item:{id:String(i)}}));
 const items=[{id:'1',price:20},{id:'1',price:20},{id:'2',price:30}];
 const next=selectInventoryPage(old,items,'source',2);
 assert.equal(next.length,200);assert.equal(old.length,199);
 assert.equal(next[199].key,'source:1');assert.equal(next[199].ref.page,2);
 assert.equal(selectInventoryPage(next,items,'source',2).length,200);
});
test('deselecting a page preserves selections in other accounts and other pages',async()=>{
 const {deselectInventoryPage}=await load();
 const old=[{key:'a:1'},{key:'a:2'},{key:'b:1'}];
 assert.deepEqual(deselectInventoryPage(old,[{id:'1'}],'a'),[{key:'a:2'},{key:'b:1'}]);
});
test('selected value reports missing prices without inventing a complete total',async()=>{
 const {inventorySelectionTotals}=await load();
 assert.deepEqual(inventorySelectionTotals([{ref:{accountId:'a'},item:{price:20}},{ref:{accountId:'b'},item:{price:null}},{ref:{accountId:'a'},item:{price:0}}]),{count:3,value:20,unknownPrices:1,accounts:2});
});
