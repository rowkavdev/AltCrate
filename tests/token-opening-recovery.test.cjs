const test=require('node:test'),assert=require('node:assert/strict');
let reconcileOpening,recordMissingStickers;try{({reconcileOpening,recordMissingStickers}=require('../scripts/helpers/recover-token-opening.cjs'));}catch{}
const row={sourceIdentity:'owner',state:'unconfirmed',stage:'open',updatedAt:'2026-10-14T09:26:17.000Z',pending:{kind:'open',id:'64d9ecad463b7ffa9697e2ea',before:10,amount:2},opened:0,converted:0};
const sticker=(id,extra={})=>({_id:id.repeat(24),userId:'owner',isSticker:true,isFavorite:false,openedAt:'2026-10-14T09:26:16.900Z',origin:{name:'Atlanta 2017 Legends (Holo-Foil)',type:'case'},...extra});
test('read-only reconciliation queues exactly the owned stickers from the failed opening without reopening',()=>{
  assert.equal(typeof reconcileOpening,'function');
  const recovered=reconcileOpening(row,{identity:'owner',quantity:8,skins:[sticker('a'),sticker('b'),sticker('c',{openedAt:'2026-10-13T09:26:16.900Z'})]});
  assert.equal(recovered.state,'stopped');assert.equal(recovered.pending,null);assert.equal(recovered.opened,2);
  assert.deepEqual(recovered.remainingSkinIds,['a'.repeat(24),'b'.repeat(24)]);assert.equal(row.pending.kind,'open');
});
test('an applied opening with a complete empty sticker inventory is recorded as failed without counting conversions',()=>{
  assert.equal(typeof recordMissingStickers,'function');
  const context={identity:'owner',quantity:8,skins:[],inventoryComplete:true,humanConfirmedUnchanged:true,config:{autosellActivated:true,autosellVariant:'money'}};
  const result=recordMissingStickers(row,context);assert.equal(result.state,'failed');assert.equal(result.pending,null);assert.equal(result.opened,2);assert.equal(result.converted,0);assert.equal(result.missingStickers,2);assert.equal(result.verified,false);
  for(const changed of [{inventoryComplete:false},{humanConfirmedUnchanged:false},{quantity:9},{identity:'other'},{skins:[sticker('a')]},{config:{autosellActivated:false,autosellVariant:'money'}}])assert.throws(()=>recordMissingStickers(row,{...context,...changed}));
});
test('reconciliation refuses inconsistent stock or identity and incomplete, duplicate, favorite or unrelated stickers',()=>{
  assert.equal(typeof reconcileOpening,'function');
  for(const context of [
    {identity:'other',quantity:8,skins:[sticker('a'),sticker('b')]},
    {identity:'owner',quantity:9,skins:[sticker('a'),sticker('b')]},
    {identity:'owner',quantity:8,skins:[sticker('a')]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('a')]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('b',{isFavorite:true})]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('b',{origin:{name:'Other Capsule',type:'case'}})]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('b',{userId:'other'})]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('b',{openedAt:'2026-10-14T09:00:00.000Z'})]},
    {identity:'owner',quantity:8,skins:[sticker('a'),sticker('b'),sticker('c')]}
  ])assert.throws(()=>reconcileOpening(row,context));
});
