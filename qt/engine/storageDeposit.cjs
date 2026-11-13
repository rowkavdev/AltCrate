const {parseRetryAfter}=require('./scheduler.cjs');
const {validId}=require('./inventoryItemLocator.cjs');

function createStorageDeposit({listAccounts,listStorageUnits,apiForAccount,locator,accountQueue,coordinator,now=Date.now}){
 async function completeScan(accountId,itemId,storageUnitId){
  let cursor=null;
  for(let segment=0;segment<500;segment++){
   const result=await locator.scan(accountId,itemId,storageUnitId,cursor);
   if(result.outcome!=='unknown'||!result.cursor)return result;
   if(cursor&&result.cursor.page<=cursor.page)return {outcome:'unknown'};
   cursor=result.cursor;
  }
  return {outcome:'unknown'};
 }
 async function preflight(accountId,storageUnitId){
  if(typeof accountId!=='string'||!validId(storageUnitId))throw Error('Storage inválido');
  const account=(await listAccounts()).find(item=>item.id===accountId);
  if(!account)throw Error('Conta de destino não encontrada');
  const storage=(await listStorageUnits(accountId)).find(item=>item.id===storageUnitId);
  if(!storage)throw Error('Storage não encontrado nesta conta');
  const identity=await locator.identity(accountId);
  return {account,storage,identity};
 }
 async function verifyComplete(record){
  if(!validId(record?.ref?.itemId))throw Error('Item inválido');
  const checked=await preflight(record.destinationAccountId,record.destinationStorageUnitId);
  if(checked.identity!==record.destinationIdentity)throw Error('A identidade da conta de destino mudou');
  const inventory=await completeScan(checked.account.id,record.ref.itemId,null);
  const storage=await completeScan(checked.account.id,record.ref.itemId,record.destinationStorageUnitId);
  const inInventory=inventory.outcome==='found'?true:inventory.outcome==='absent'?false:null;
  const inStorage=storage.outcome==='found'?true:storage.outcome==='absent'?false:null;
  return {inInventory,inStorage,location:inInventory===false&&inStorage===true?'storage':inInventory===true&&inStorage===false?'inventory':'unknown'};
 }
 async function sendOnce(record){
  if(!validId(record?.ref?.itemId))throw Error('Item inválido');
  const checked=await preflight(record.destinationAccountId,record.destinationStorageUnitId);
  if(checked.identity!==record.destinationIdentity)throw Error('A identidade da conta de destino mudou');
  if(checked.storage.count>=1000){const error=Error('O cofre já atingiu o limite de 1000 skins');error.notSent=true;throw error;}
  const location=await verifyComplete(record);
  if(location.location!=='inventory'){const error=Error('Localização do item não confirmada no inventário de destino');error.notSent=true;throw error;}
  const send=async()=>{
   if(await coordinator?.cooldown()>now()){const error=Error('Aguarda o limite da API antes de continuar');error.notSent=true;throw error;}
   return apiForAccount(checked.account).depositStorageSkin(record.ref.itemId,record.destinationStorageUnitId);
  };
  const result=accountQueue?await accountQueue.run(checked.account.id,send):await send();
  if(result.status===429&&coordinator)await coordinator.limit(now()+parseRetryAfter(result.retryAfter,now()));
  return result;
 }
 async function verify(record){
  if(!validId(record?.ref?.itemId))throw Error('Item inválido');
  const checked=await preflight(record.destinationAccountId,record.destinationStorageUnitId);
  if(checked.identity!==record.destinationIdentity)throw Error('A identidade da conta de destino mudou');
  const outcomes=await Promise.allSettled([
   locator.scan(checked.account.id,record.ref.itemId,null,record.depositInventoryCursor||null),
   locator.scan(checked.account.id,record.ref.itemId,record.destinationStorageUnitId,record.depositStorageCursor||null),
  ]);
  record.depositInventoryCursor=outcomes[0].status==='fulfilled'?outcomes[0].value.cursor||null:null;
  record.depositStorageCursor=outcomes[1].status==='fulfilled'?outcomes[1].value.cursor||null:null;
  const read=index=>outcomes[index].status==='fulfilled'?(outcomes[index].value.outcome==='found'?true:outcomes[index].value.outcome==='absent'?false:null):null;
  const inInventory=read(0),inStorage=read(1);
  return {inInventory,inStorage,location:inInventory===false&&inStorage===true?'storage':inInventory===true&&inStorage===false?'inventory':'unknown'};
 }
 return {preflight,sendOnce,verify,verifyComplete};
}
module.exports={createStorageDeposit};
