const {randomUUID}=require('node:crypto');
const {validId}=require('./inventoryItemLocator.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');

function createStorageManagement({reader,listAccounts,apiForAccount,locator,accountQueue,coordinator,store,emit=()=>{},now=Date.now}){
 let records=[],initialization,busy=false;
 const previews=new Map();
 const view=r=>{const copy=structuredClone(r);delete copy.identity;delete copy.beforeIds;delete copy.skinIds;return copy;};
 async function ready(){initialization||=(async()=>{const saved=await store.load();if(saved!=null&&(saved.version!==1||!Array.isArray(saved.operations)))throw Error('Registo de cofres inválido');records=saved?.operations||[];for(const r of records)if(r.state==='sending')r.state='unconfirmed';})();return initialization;}
 async function save(r){const next=[r,...records.filter(v=>v.operationId!==r.operationId)];await store.save({version:1,operations:next});records=structuredClone(next);emit({type:'storage-management',accountId:r.accountId,operation:view(r)});return view(r);}
 async function exclusive(work){if(busy)throw Error('Aguarda a operação do cofre');busy=true;try{return await work();}finally{busy=false;}}
 async function contents(accountId,unit){
  const ids=new Set();let pages=1;
  for(let page=1;page<=pages;page++){
   const data=await reader.read(accountId,unit.id,page,{favorites:'all',sort:'true'});
   if(!Number.isSafeInteger(data.pages)||data.pages<1||data.pages>1000)throw Error('Não foi possível rever todo o cofre');pages=data.pages;
   for(const skin of data.skins){if(!validId(skin.id)||ids.has(skin.id))throw Error('O conteúdo do cofre mudou durante a revisão');ids.add(skin.id);}
  }
  if(ids.size!==unit.count)throw Error('O conteúdo do cofre mudou. Atualiza e revê novamente.');
  return [...ids].sort();
 }
 async function prepare(input){
  await ready();if(!input||!['create','rename','delete','clear'].includes(input.kind)||typeof input.accountId!=='string')throw Error('Ação do cofre inválida');
  if(records.some(r=>r.state==='unconfirmed'||r.state==='sending'))throw Error('Verifica primeiro a operação do cofre por confirmar');
  const account=(await listAccounts()).find(a=>a.id===input.accountId);if(!account)throw Error('Conta não encontrada');
  if(input.kind==='rename'&&(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>20))throw Error('O nome deve ter entre 1 e 20 caracteres');
  if(input.kind!=='create'&&!validId(input.storageUnitId))throw Error('Cofre inválido');
  const identity=await locator.identity(account.id),units=await reader.list(account.id),unit=units.find(u=>u.id===input.storageUnitId);
  if(input.kind!=='create'&&!unit)throw Error('Cofre não encontrado nesta conta');
  let index=0;while(units.some(u=>u.index===index))index++;
  if(input.kind==='create'&&units.some(u=>u.index==null))throw Error('A lista de cofres não indica as posições. Atualiza antes de criar.');
  const skinIds=['clear','delete'].includes(input.kind)?await contents(account.id,unit):[];
  if(await locator.identity(account.id)!==identity)throw Error('A identidade mudou durante a revisão');
  const p={previewId:randomUUID(),accountId:account.id,accountLabel:account.label,kind:input.kind,unit:unit||null,name:input.kind==='rename'?input.name.trim():null,index,beforeIds:units.map(u=>u.id),skinIds,identity,expiresAt:now()+300000};
  previews.set(p.previewId,p);return view(p);
 }
 async function verifyRecord(r){
  if(await locator.identity(r.accountId)!==r.identity)throw Error('A identidade da conta mudou. Liga a conta original para verificar.');
  const units=await reader.list(r.accountId),unit=units.find(u=>u.id===r.unit?.id);
  let proven=false;
  if(r.kind==='create'){
   const added=units.filter(u=>!r.beforeIds.includes(u.id)&&u.index===r.index);
   proven=added.length===1;if(proven)r.createdUnit=added[0];
  }else if(r.kind==='rename')proven=unit?.name===r.name;
  else{
   proven=r.kind==='delete'?!unit:!!unit&&unit.count===0;
   if(proven&&r.kind==='clear')proven=(await contents(r.accountId,unit)).length===0;
   // Require every reviewed skin to be present in the original account's inventory.
   for(const skinId of r.skinIds){
    if(!proven)break;let cursor=null,found=false;
    for(let segment=0;segment<500;segment++){
     const result=await locator.scan(r.accountId,skinId,null,cursor);
     if(result.outcome==='found'){found=true;break;}
     if(result.outcome!=='unknown'||!result.cursor||cursor&&result.cursor.page<=cursor.page)break;
     cursor=result.cursor;
    }
    proven=found;
   }
  }
  if(await locator.identity(r.accountId)!==r.identity)throw Error('A identidade mudou durante a verificação');
  r.state=proven?'confirmed':'unconfirmed';r.verified=proven;r.message=proven?({create:'Cofre criado',rename:'Nome do cofre atualizado',delete:'Cofre apagado; skins verificadas no inventário',clear:'Cofre esvaziado; skins verificadas no inventário'}[r.kind]):'Resultado por confirmar. Verifica o estado sem repetir a ação.';
  return save(r);
 }
 async function confirm(previewId){return exclusive(async()=>{
  await ready();const saved=records.find(r=>r.previewId===previewId);if(saved)return view(saved);
  const p=previews.get(previewId);if(!p||p.expiresAt<now())throw Error('A revisão expirou. Revê novamente.');
  if(records.some(r=>['sending','unconfirmed'].includes(r.state)))throw Error('Verifica primeiro a operação pendente');
  const account=(await listAccounts()).find(a=>a.id===p.accountId);if(!account)throw Error('Conta não encontrada');
  const fresh=await prepare({kind:p.kind,accountId:p.accountId,storageUnitId:p.unit?.id,name:p.name});
  const current=previews.get(fresh.previewId);previews.delete(fresh.previewId);
  if(current.identity!==p.identity||JSON.stringify([current.unit,current.index,current.beforeIds,current.skinIds])!==JSON.stringify([p.unit,p.index,p.beforeIds,p.skinIds]))throw Error('O cofre mudou. Atualiza e faz uma nova revisão.');
  if(p.expiresAt<now())throw Error('A revisão expirou. Revê novamente.');
  const r={...p,operationId:randomUUID(),state:'sending',verified:false,createdAt:new Date(now()).toISOString(),message:'A aplicar a alteração revista…'};
  await save(r);previews.delete(previewId);
  try{
   if(await locator.identity(p.accountId)!==p.identity){const e=Error('A identidade mudou antes do envio');e.notSent=true;throw e;}
   const work=async()=>{
    if(await coordinator?.cooldown()>now()){const e=Error('Aguarda o limite da API');e.notSent=true;throw e;}
    const api=apiForAccount(account);
    return p.kind==='create'?api.createStorageUnit(p.index):p.kind==='rename'?api.renameStorageUnit(p.unit.id,p.name,p.unit.skinIconUrl):api.deleteStorageUnit(p.unit.id,p.kind==='clear');
   };
   const result=await (accountQueue?accountQueue.run(p.accountId,work):work());
   if(result.status===429&&coordinator)await coordinator.limit(now()+parseRetryAfter(result.retryAfter,now()));
   if(!result.ok){r.state='failed';r.message=String(result.message||'HTTP '+result.status);return save(r);}
   r.state='unconfirmed';await save(r);return await verifyRecord(r);
  }catch(error){r.state=error.notSent?'failed':'unconfirmed';r.message=String(error.message||error);return save(r);}
 });}
 async function verify(id){return exclusive(async()=>{await ready();const r=structuredClone(records.find(v=>v.operationId===id));if(!r)throw Error('Operação não encontrada');if(r.state!=='unconfirmed')return view(r);try{return await verifyRecord(r);}catch(error){r.message=String(error.message||error);return save(r);}});}
 return {prepare,confirm,verify,hasPending:()=>busy||records.some(r=>['sending','unconfirmed'].includes(r.state)),async list(){await ready();return records.map(view);}};
}
function registerStorageManagementIpc({ipcMain,service}){
 ipcMain.handle('storage-management:prepare',(_e,request)=>service.prepare(request));
 for(const method of ['confirm','verify'])ipcMain.handle('storage-management:'+method,(_e,id)=>{if(typeof id!=='string'||!id||id.length>100)throw Error('Identificador inválido');return service[method](id);});
 ipcMain.handle('storage-management:list',()=>service.list());
}
module.exports={createStorageManagement,registerStorageManagementIpc};
