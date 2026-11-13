const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

// Plans are immutable after review except for the running token budget. Keep
// their large item lists out of every intent/progress checkpoint. The manifest
// points only to immutable, fully written snapshots, so a failed publication
// cannot replace the last acknowledged intent with half of a new checkpoint.
function createConverterJournalStore(file,{fileSystem=fs}={}){
 const io=fileSystem;
 const directory=file+'.d',artifacts=new Map(),written=new Set(),candidates=new Set(),latest=new Map(),planCache=new WeakMap(),queued=new Map(),dependencies=new Map(),leases=new WeakSet();
 let committedRows=new Set();
 const uncertainRows=new Set();
 let tail=Promise.resolve(),legacy=false,indexed=false;
 const hash=content=>createHash('sha256').update(content).digest('hex');
 const valid=name=>/^(?:plan|row)-[a-f0-9]{64}\.json$/.test(name);
 function trackDependencies(name,value){if(name.startsWith('row-'))dependencies.set(name,['sequencePlan','consolidationPlan'].flatMap(key=>value[key]?[value[key].file]:[]));}
 function artifact(kind,value){const content=JSON.stringify(value),name=kind+'-'+hash(content)+'.json';artifacts.set(name,content);trackDependencies(name,value);return {name,content};}
 function retain(captured){for(const entry of captured.manifest.rows)queued.set(entry.file,(queued.get(entry.file)||0)+1);}
 function release(captured){for(const entry of captured.manifest.rows){const remaining=(queued.get(entry.file)||1)-1;if(remaining)queued.set(entry.file,remaining);else queued.delete(entry.file);}}
 function detachPlan(plan,mutable,plans){
  if(!plan)return null;
  const entries=Object.entries(plan).filter(([key])=>!mutable.includes(key));
  let cached=planCache.get(plan);
  if(!cached||entries.length!==cached.entries.length||entries.some(([key,value],i)=>key!==cached.entries[i][0]||value!==cached.entries[i][1])){
   cached={entries,artifact:artifact('plan',Object.fromEntries(entries))};planCache.set(plan,cached);plans.push(cached.artifact);
  }
  if(!written.has(cached.artifact.name))artifacts.set(cached.artifact.name,cached.artifact.content);
  return {file:cached.artifact.name,mutable:structuredClone(Object.fromEntries(mutable.filter(key=>Object.hasOwn(plan,key)).map(key=>[key,plan[key]])))};
 }
 function capture(value,{row}={}){
  if(!value||value.version!==1||!Array.isArray(value.rows))throw Error('Registo do conversor inválido');
  const plans=[],changes=[],present=new Set(value.rows.map(item=>item.operationId));
  for(const item of value.rows){
   if(row&&item!==row&&latest.has(item.operationId))continue;
   const {sequencePlan,consolidationPlan,...progress}=item;
   const encoded={progress:structuredClone(progress),sequencePlan:detachPlan(sequencePlan,['tokenBudget'],plans),consolidationPlan:detachPlan(consolidationPlan,[],plans)};
   const saved=artifact('row',encoded);latest.set(item.operationId,{operationId:item.operationId,file:saved.name});changes.push(saved);
  }
  for(const id of latest.keys())if(!present.has(id))latest.delete(id);
  const {rows,version,...header}=value;
  const captured={journalCapture:true,manifest:{...structuredClone(header),version:2,rows:rows.map(item=>({...latest.get(item.operationId)}))},changes,plans};
  // Capture is a queued intent even before the outer engine publication chain
  // reaches save(). Keep its immutable dependencies alive across intervening GC.
  retain(captured);leases.add(captured);return captured;
 }
 async function atomic(target,content){
  await io.mkdir(path.dirname(target),{recursive:true,mode:0o700});
  const tmp=target+'.'+randomUUID()+'.tmp';let handle;
  try{handle=await io.open(tmp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;await io.rename(tmp,target);handle=await io.open(path.dirname(target),'r');await handle.sync();await handle.close();handle=null;}
  finally{if(handle)await handle.close();await io.rm(tmp,{force:true}).catch(()=>{});}
 }
 async function readArtifact(name){
  if(!valid(name))throw Error('Referência inválida no registo do conversor');
  const content=await io.readFile(path.join(directory,name),'utf8');
  if(name.split('-')[1].slice(0,-5)!==hash(content))throw Error('Falha de integridade no plano ou progresso do conversor');
  written.add(name);
  const value=JSON.parse(content);trackDependencies(name,value);return value;
 }
 async function load(){
  let value;try{value=JSON.parse(await io.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(value.version===1){legacy=true;return value;}
  if(value.version!==2||!Array.isArray(value.rows))throw Error('Registo do conversor inválido');
  const {rows,...header}=value,restored=[];
  committedRows=new Set(rows.map(entry=>entry.file));
  for(const entry of rows){
   if(!entry||typeof entry.operationId!=='string')throw Error('Operação inválida no registo do conversor');
   const data=await readArtifact(entry.file);if(data.progress?.operationId!==entry.operationId)throw Error('Identidade inválida no registo do conversor');
   const item={...data.progress};
   for(const key of ['sequencePlan','consolidationPlan'])if(data[key])item[key]={...await readArtifact(data[key].file),...data[key].mutable};
   restored.push(item);
  }
  return {...header,version:1,rows:restored};
 }
 function save(value){
  const captured=value?.journalCapture?value:capture(value);
  if(leases.has(captured))leases.delete(captured);else retain(captured);
  const task=tail.catch(()=>{}).then(async()=>{
   await io.mkdir(directory,{recursive:true,mode:0o700});
   if(!indexed){for(const name of await io.readdir(directory))if(valid(name))candidates.add(name);indexed=true;}
   if(legacy){try{await io.copyFile(file,file+'.legacy-v1.json',fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}legacy=false;}
   // A queued checkpoint may reference an artifact first captured by an earlier
   // failed write. Keep it available until a later complete save acknowledges it.
   const ensure=async name=>{
    if(name.startsWith('row-')){
     if(!dependencies.has(name)){
      const content=artifacts.get(name);if(content===undefined)await readArtifact(name);else trackDependencies(name,JSON.parse(content));
     }
     // A leased row can survive cleanup while its previously unreferenced plan
     // is already being removed. Re-establish every dependency even if the row
     // file itself is still present.
     for(const dependency of dependencies.get(name)||[])await ensure(dependency);
    }
    if(written.has(name))return;
    const content=artifacts.get(name);
    if(content===undefined){await readArtifact(name);written.add(name);return;}
    await atomic(path.join(directory,name),content);written.add(name);artifacts.delete(name);
   };
   for(const entry of captured.manifest.rows)await ensure(entry.file);
   // A failed directory sync may follow a successful manifest rename. Both the
   // old and attempted manifests must stay restartable until a later durable
   // publication establishes which set can be reclaimed.
   for(const entry of captured.manifest.rows)uncertainRows.add(entry.file);
   await atomic(file,JSON.stringify(captured.manifest));
   committedRows=new Set(captured.manifest.rows.map(entry=>entry.file));
   uncertainRows.clear();
  }).finally(async()=>{
   release(captured);
   for(const name of new Set([...written,...candidates])){
    // A new capture can arrive while unlink is awaiting the filesystem. Check
    // current leases for each deletion, then retire caches synchronously first.
    // A racing capture repopulates its data and the serialized writer recreates
    // the artifact after cleanup, without losing that newly captured content.
    const retained=new Set([...committedRows,...uncertainRows,...queued.keys(),...[...latest.values()].map(entry=>entry.file)]);
    const keep=name.startsWith('row-')?retained.has(name):[...retained].some(rowName=>dependencies.get(rowName)?.includes(name));
    if(keep)continue;
    written.delete(name);candidates.delete(name);artifacts.delete(name);dependencies.delete(name);
    try{await io.unlink(path.join(directory,name));}catch{}
   }
  });tail=task;return task;
 }
 return {load,capture,save,async archive(value){const {createJsonStore}=require('./jsonStore.cjs');await createJsonStore(path.join(path.dirname(file),'converter-history',value.archiveId+'.json')).save(value);}};
}
module.exports={createConverterJournalStore};
