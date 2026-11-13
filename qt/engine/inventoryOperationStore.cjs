const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
// Persist only our operation schema, never arbitrary API responses or credentials.
const fields=['operationId','kind','ref','item','accountId','destinationAccountId','destinationStorageUnitId','destinationStorageName','locationAccountId','sourceLabel','destinationLabel','state','stage','message','verified','httpStatus','observedMoney','observedTokens','location','updatedAt','previewId','request','reviewedItem','tradeId','sourceIdentity','destinationIdentity','intent','responseAccepted','cancelSent','cursor','storageCursor','destinationCursor','withdrawAccepted','transferConfirmed','createdAt','lastTrade','sentCommands'];
function clean(record){const output={};for(const key of fields)if(Object.hasOwn(record,key))output[key]=structuredClone(record[key]);return output;}
function createInventoryOperationStore({filePath}){
 let records=new Map(),loaded=false,chain=Promise.resolve();
 async function load(){if(loaded)return;try{const body=JSON.parse(await fs.readFile(filePath,'utf8'));if(body.version!==1||!Array.isArray(body.records))throw Error('Registo de operações inválido');records=new Map(body.records.map(r=>{if(typeof r?.operationId!=='string')throw Error('Registo de operações inválido');return [r.operationId,clean(r)];}));}catch(e){if(e.code!=='ENOENT')throw e;}loaded=true;}
 return {load,async list(){await chain;await load();return [...records.values()].map(r=>structuredClone(r));},async get(id){await chain;await load();return structuredClone(records.get(id));},put(record){
  const work=async()=>{await load();if(typeof record?.operationId!=='string'||!record.operationId)throw Error('Operação inválida');const next=new Map(records);next.set(record.operationId,clean(record));await fs.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});const temp=filePath+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify({version:1,records:[...next.values()]}),{mode:0o600});await fs.rename(temp,filePath);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}records=next;};
  const result=chain.then(work);chain=result.catch(()=>{});return result;
 }};
}
module.exports={createInventoryOperationStore};
