const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../../casepilot/apps/web/src/openingViewModel.js');
const accounts=[{id:'a',label:'Alpha'},{id:'b',label:'Beta'},{id:'c',label:'Missing reading'}];
const catalog=[{id:'x',name:'Shadow Case',category:'cases',image:'image-x'},{id:'y',name:'Sticker Capsule',category:'capsules'},{id:'z',name:'Alpha Case',category:'cases'}];
const snapshots={a:{cases:[{id:'x',amount:12},{id:'y',amount:5}]},b:{cases:[{id:'x',amount:8},{id:'z',name:'Fallback',amount:3}]}};
test('catalog stock counts each selected account once and retains unowned catalogue entries',async()=>{
 const {createOpeningCatalog}=await load();const rows=createOpeningCatalog({catalog,accounts,selectedIds:['a','a','c','unknown'],snapshots});
 assert.equal(rows.length,3);const x=rows.find(row=>row.id==='x');assert.equal(x.total,12);assert.deepEqual(x.holderIds,['a','b']);assert.deepEqual(x.selectedHolderIds,['a']);assert.deepEqual(x.stockByAccount,{a:12,b:8});assert.equal(rows.find(row=>row.id==='z').total,0);
});
test('owned cases absent from the public catalogue remain available with their observed name',async()=>{
 const {createOpeningCatalog}=await load();const rows=createOpeningCatalog({catalog:[],accounts,selectedIds:['b'],snapshots});assert.equal(rows.find(row=>row.id==='z').name,'Fallback');assert.equal(rows.find(row=>row.id==='z').total,3);
});
test('category, favorites and accent-insensitive search compose before pagination',async()=>{
 const {createOpeningCatalog,openingCatalogPage}=await load();const rows=createOpeningCatalog({catalog,accounts,selectedIds:['a','b'],snapshots});
 const result=openingCatalogPage(rows,{category:'cases',favoritesOnly:true,favorites:['x'],query:'shádow',page:20,pageSize:12});assert.deepEqual(result.items.map(row=>row.id),['x']);assert.equal(result.page,1);assert.equal(result.total,1);
 const onlyStock=openingCatalogPage(rows,{stockOnly:true,sort:'quantity',pageSize:12});assert.deepEqual(onlyStock.items.map(row=>row.id),['x','y','z']);
});
test('pagination stays bounded and out-of-range pages clamp after a filter changes',async()=>{
 const {openingCatalogPage}=await load();const rows=Array.from({length:83},(_,i)=>({id:String(i),name:'Case '+String(i).padStart(2,'0'),category:'cases',total:1}));const result=openingCatalogPage(rows,{page:3,pageSize:12,sort:'name'});assert.equal(result.items.length,12);assert.equal(result.items[0].id,'24');assert.equal(result.pages,7);assert.equal(openingCatalogPage(rows,{query:'Case 82',page:7,pageSize:12}).page,1);
});
test('quantity preview caps each account independently and rejects non-integer inputs',async()=>{
 const {openingQuantityPreview}=await load();assert.deepEqual(openingQuantityPreview({a:12,b:8},['a','b','b','c'],10),{valid:true,total:18,accounts:2});for(const count of ['1.5',0,-1,10001,''])assert.equal(openingQuantityPreview({a:12},['a'],count).valid,false);assert.deepEqual(openingQuantityPreview({a:12,b:8},['a','b'],null),{valid:true,total:20,accounts:2});
});
test('removing accounts without stock preserves the chosen accounts and unread or failed stock',async()=>{
 const {openingAccountsWithoutStock}=await load();
 const readings={...snapshots,empty:{cases:[]},other:{cases:[{id:'z',amount:4}]},failed:{error:'Read failed'},stale:{cases:[],refreshError:{message:'Read failed'}},summary:{casesTotal:0}};
 const selected=['empty','a','c','other','failed','stale','summary'];
 const remove=openingAccountsWithoutStock({a:12,b:8},selected,readings);
 assert.deepEqual(remove,['empty','other']);
 assert.deepEqual(selected.filter(id=>!remove.includes(id)),['a','c','failed','stale','summary']);
 assert.deepEqual(openingAccountsWithoutStock({a:12},['a'],readings),[]);
 assert.deepEqual(selected,['empty','a','c','other','failed','stale','summary']);
});
