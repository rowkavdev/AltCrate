const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {validId}=require('./inventoryItemLocator.cjs');
const LIMITATION='As transferências usam trocas individuais verificadas, uma por item. Uma oferta com vários itens e os seus limites não estão comprovados.';
const itemFields=['id','name','baseName','patternName','price','weaponPrice','nickname','rarity','exterior','float','patternId','hasPattern','quality','origin','isFavorite','statTrak','souvenir','eventName','type','weapon','weaponType','gunType','knifeType','isFromArmory','stickers','charm'];
const clone=value=>structuredClone(value);
const safeItem=value=>Object.fromEntries(itemFields.filter(key=>Object.hasOwn(value||{},key)).map(key=>[key,clone(value[key])]));
const safePreview=p=>({previewId:p.previewId,kind:p.kind,ref:clone(p.ref),item:safeItem(p.item),sourceLabel:p.sourceLabel,destinationAccountId:p.destinationAccountId,destinationLabel:p.destinationLabel,destinationStorageUnitId:p.destinationStorageUnitId,destinationStorageName:p.destinationStorageName,steps:clone(p.steps||[])});
const samePreview=(a,b)=>JSON.stringify([a.kind,a.ref.accountId,a.ref.itemId,a.ref.storageUnitId,a.item,a.sourceLabel,a.destinationAccountId,a.destinationLabel,a.destinationStorageUnitId,a.destinationStorageName])===JSON.stringify([b.kind,b.ref.accountId,b.ref.itemId,b.ref.storageUnitId,b.item,b.sourceLabel,b.destinationAccountId,b.destinationLabel,b.destinationStorageUnitId,b.destinationStorageName]);
function createInventoryBatch({actions,operationStore,locator,filePath,emit=()=>{},now=Date.now,pollMs=250,pollAttempts=240}){
 let initialization,chain=Promise.resolve(),batches=new Map(),activeBatch=null;
 const tasks=new Map(),activeRecords=new Map();
 const stamp=()=>new Date(now()).toISOString();
 const view=record=>{const result=clone(record);for(const item of result.items){delete item.sourceIdentity;delete item.destinationIdentity;}return result;};
 async function persist(record){
  const snapshot=clone({...record,updatedAt:stamp()});
  const work=async()=>{const next=new Map(batches);next.set(snapshot.batchId,snapshot);await fs.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});const temp=filePath+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify({version:1,batches:[...next.values()]}),{mode:0o600});await fs.rename(temp,filePath);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}batches=next;emit({type:'inventory-batch',at:snapshot.updatedAt,batch:view(snapshot)});return view(snapshot);};
  const result=chain.then(work);chain=result.catch(()=>{});return result;
 }
 async function ready(){initialization||=(async()=>{
  try{const body=JSON.parse(await fs.readFile(filePath,'utf8'));if(body.version!==1||!Array.isArray(body.batches)||body.batches.length>1000)throw Error('Registo de lotes inválido');for(const record of body.batches){if(typeof record?.batchId!=='string'||!Array.isArray(record.items)||record.items.length>200)throw Error('Registo de lotes inválido');batches.set(record.batchId,record);}}
  catch(error){if(error.code!=='ENOENT')throw error;}
  for(const saved of [...batches.values()])if(saved.state==='running'||saved.items.some(item=>item.state==='submitting')){const r=clone(saved);r.state='paused';r.stopRequested=true;for(const item of r.items)if(item.state==='submitting'){item.state='unconfirmed';item.message='Operação interrompida. Verifica antes de continuar.';}await persist(r);}
 })();return initialization;}
 async function get(id){await ready();await chain;const r=batches.get(id);if(!r)throw Error('Lote não encontrado');return clone(r);}
 function request(input){
  if(!input||!['transfer','move-to-storage','withdraw','sell','convert'].includes(input.kind)||!Array.isArray(input.refs)||input.refs.length<1||input.refs.length>200)throw Error('Seleciona entre 1 e 200 itens para o lote');
  if(['transfer','move-to-storage'].includes(input.kind)&&(typeof input.destinationAccountId!=='string'||!input.destinationAccountId||input.destinationAccountId.length>100))throw Error('Conta de destino inválida');
  if(input.kind==='move-to-storage'&&!validId(input.destinationStorageUnitId))throw Error('Storage de destino inválido');
  const seen=new Set(),refs=input.refs.map(r=>{if(typeof r?.accountId!=='string'||!r.accountId||r.accountId.length>100||!validId(r.itemId)||r.storageUnitId!=null&&!validId(r.storageUnitId)||!Number.isSafeInteger(r.page)||r.page<1||r.page>10000)throw Error('Referência de item inválida');const key=r.accountId+':'+r.itemId;if(seen.has(key))throw Error('Item repetido no lote');seen.add(key);return {accountId:r.accountId,itemId:r.itemId,storageUnitId:r.storageUnitId??null,page:r.page,name:String(r.name||'').slice(0,180)};});
  return {kind:input.kind,refs,...(['transfer','move-to-storage'].includes(input.kind)?{destinationAccountId:input.destinationAccountId}:{}),...(input.kind==='move-to-storage'?{destinationStorageUnitId:input.destinationStorageUnitId}:{})};
 }
 function rowRequest(r,row){return {kind:r.kind,ref:row.ref,...(['transfer','move-to-storage'].includes(r.kind)?{destinationAccountId:r.destinationAccountId}:{}),...(r.kind==='move-to-storage'?{destinationStorageUnitId:r.destinationStorageUnitId}:{})};}
 async function identities(ref,destination){return {sourceIdentity:await locator.identity(ref.accountId),destinationIdentity:destination?await locator.identity(destination):null};}
 async function prepare(input){
  await ready();if(batches.size>=1000)throw Error('Limite local de 1000 lotes atingido');const value=request(input),record={batchId:randomUUID(),kind:value.kind,destinationAccountId:value.destinationAccountId,destinationStorageUnitId:value.destinationStorageUnitId,state:'review',stopRequested:false,createdAt:stamp(),expiresAt:now()+300000,limitation:['sell','convert'].includes(value.kind)?'Cada item é revalidado e confirmado individualmente. Os favoritos estão protegidos. A venda e a conversão são irreversíveis.':LIMITATION,capacity:{known:true,limit:1000,message:'O jogo publica um limite de 1000 skins por cofre. Cada depósito será revalidado e confirmado individualmente.'},items:[]};
  for(const ref of value.refs){const before=await identities(ref,value.destinationAccountId),preview=safePreview(await actions.prepare({...value,refs:undefined,ref})),identity=await identities(ref,value.destinationAccountId);if(before.sourceIdentity!==identity.sourceIdentity||before.destinationIdentity!==identity.destinationIdentity)throw Error('A identidade mudou durante a revisão. Revê as contas.');record.items.push({ref,preview,...identity,state:'queued',operationId:null,message:'Por executar',finalLocation:null});}
  return persist(record);
 }
 function apply(row,op,r){
  row.operationId=op.operationId;row.message=String(op.message||'');row.canResume=op.canResume===true;
  if(op.kind!==r.kind||op.accountId!==row.ref.accountId||op.item?.id!==row.ref.itemId||(['transfer','move-to-storage'].includes(r.kind)&&op.destinationAccountId!==r.destinationAccountId)||(r.kind==='move-to-storage'&&op.destinationStorageUnitId!==r.destinationStorageUnitId)){row.state='unconfirmed';row.finalLocation=null;row.message='A operação não corresponde ao item e destino revistos. Verifica o registo individual.';return;}
  if(op.state==='confirmed'&&op.verified===true){row.state='confirmed';row.finalLocation={accountId:['transfer','move-to-storage'].includes(r.kind)?r.destinationAccountId:row.ref.accountId,storageUnitId:r.kind==='move-to-storage'?r.destinationStorageUnitId:null,location:r.kind==='move-to-storage'?'storage':['sell','convert'].includes(r.kind)?r.kind==='sell'?'sold':'converted':'inventory'};}
  else if(['failed','cancelled'].includes(op.state)){row.state=op.state;row.finalLocation=null;}
  else{row.state='unconfirmed';row.finalLocation=null;}
 }
 async function settle(row,op,r){
  // A transfer runs asynchronously. Let the existing transfer service finish its
  // guarded offer flow; never start a competing verification while it is running.
  for(let attempt=0;op?.state==='running'&&attempt<pollAttempts;attempt++){await new Promise(resolve=>setTimeout(resolve,pollMs));op=(await actions.list()).find(value=>value.operationId===op.operationId)||op;}
  apply(row,op,r);
 }
 async function reconcile(r){
  await actions.list();const journal=await operationStore.list();
  for(const row of r.items){if(!['submitting','unconfirmed'].includes(row.state))continue;const op=journal.find(value=>value.operationId===row.operationId||value.previewId===row.preview.previewId);
   if(!op){row.state='unconfirmed';row.message='Envio sem correlação no registo. Não será repetido; consulta as operações individuais.';continue;}
   row.operationId=op.operationId;const current=(await actions.list()).find(value=>value.operationId===op.operationId)||op;
   if(current.state==='running'){await settle(row,current,r);continue;}
   try{apply(row,await actions.verify(op.operationId),r);}catch(error){row.state='unconfirmed';row.message=String(error.message||error);}
  }
  r.state=r.items.every(row=>row.state==='confirmed')?'completed':r.stopRequested?'stopped':'paused';return persist(r);
 }
 async function verify(id){await ready();if(tasks.has(id))return view(await get(id));const r=await get(id);return reconcile(r);}
 async function run(id,resuming){
  const r=await get(id);if([...batches.values()].some(other=>other.batchId!==id&&other.items.some(row=>['submitting','unconfirmed'].includes(row.state))))throw Error('Outro lote tem um resultado pendente. Verifica esse lote primeiro.');if(activeBatch&&activeBatch!==id)throw Error('Outro lote está em execução');if(r.state==='completed')return view(r);
  if(r.expiresAt<now())throw Error('A revisão expirou. Revê os itens restantes num novo lote.');
  if(r.items.some(row=>row.state==='blocked'))throw Error('O item mudou. Revê os itens restantes num novo lote.');
  activeBatch=id;activeRecords.set(id,r);
  try{
   if(resuming&&r.items.some(row=>['submitting','unconfirmed'].includes(row.state))){await reconcile(r);if(r.items.some(row=>row.state!=='confirmed'&&row.state!=='queued'))return view(await get(id));}
   if(r.items.some(row=>!['confirmed','queued'].includes(row.state)))return view(r);
   r.stopRequested=false;r.state='running';await persist(r);
   for(const row of r.items){
    if(r.stopRequested)break;if(row.state==='confirmed')continue;if(r.expiresAt<now()){r.message='A revisão expirou. Revê os itens restantes num novo lote.';break;}
    try{
     const identity=await identities(row.ref,r.destinationAccountId);if(identity.sourceIdentity!==row.sourceIdentity||identity.destinationIdentity!==row.destinationIdentity)throw Error('A identidade de uma conta mudou. É necessária nova revisão.');
     const current=safePreview(await actions.prepare(rowRequest(r,row)));if(!samePreview(current,row.preview))throw Error('O item ou destino mudou. É necessária nova revisão.');
     row.preview=current;
    }catch(error){row.state='blocked';row.message=String(error.message||error);r.state='paused';await persist(r);return view(r);}
    if(r.stopRequested)break;if(r.expiresAt<now()){r.message='A revisão expirou. Revê os itens restantes num novo lote.';break;}
    row.state='submitting';row.message='A enviar; a localização será verificada';await persist(r);
    if(r.stopRequested||r.expiresAt<now()){row.state='queued';row.message='Por executar';if(!r.stopRequested)r.message='A revisão expirou. Revê os itens restantes num novo lote.';break;}
    try{const result=await actions.confirm(row.preview.previewId);if(result.reviewRequired){row.state='blocked';row.message='O item mudou durante a confirmação. Faz uma nova revisão.';}else await settle(row,result.operation,r);}
    catch(error){row.state='unconfirmed';row.message=String(error.message||error);}
    await persist(r);if(row.state!=='confirmed')break;
   }
   r.state=r.items.every(row=>row.state==='confirmed')?'completed':r.stopRequested?'stopped':'paused';return persist(r);
  }finally{activeRecords.delete(id);if(activeBatch===id)activeBatch=null;}
 }
 function start(id,resuming=false){if(tasks.has(id))return tasks.get(id);const task=run(id,resuming);tasks.set(id,task);task.finally(()=>tasks.delete(id)).catch(()=>{});return task;}
 async function stop(id){const r=activeRecords.get(id)||await get(id);r.stopRequested=true;if(r.state!=='running')r.state='stopped';return persist(r);}
 return {prepare,hasPending(){return tasks.size>0||[...batches.values()].some(r=>r.items.some(item=>['submitting','unconfirmed'].includes(item.state)));},start:id=>start(id),resume:id=>start(id,true),stop,verify,async list(){await ready();await chain;return [...batches.values()].map(view);},blocksAccount(accountId){const r=activeRecords.get(activeBatch);return !!r&&r.items.some(row=>row.ref.accountId===accountId||r.destinationAccountId===accountId);}};
}
function registerInventoryBatchIpc({ipcMain,service}){
 const id=value=>{if(typeof value!=='string'||!value||value.length>100)throw Error('Lote inválido');return value;};
 ipcMain.handle('inventory-batch:prepare',(_event,request)=>service.prepare(request));
 for(const method of ['start','stop','verify','resume'])ipcMain.handle('inventory-batch:'+method,(_event,value)=>service[method](id(value)));
 ipcMain.handle('inventory-batch:list',()=>service.list());
}
module.exports={createInventoryBatch,registerInventoryBatchIpc};
