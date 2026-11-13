const {randomUUID}=require('node:crypto');
const STORE_ID=/^[A-Za-z0-9_-]{1,120}$/;
const ITEM_ID=/^[a-f0-9]{24}$/i;
const copy=value=>structuredClone(value);
function object(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!fields.includes(key)))throw Error('Configuração local inválida');
 return value;
}
function identifier(value){if(typeof value!=='string'||!STORE_ID.test(value)||['__proto__','constructor','prototype'].includes(value))throw Error('Identificador inválido');return value;}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\x00-\x1f\x7f]/.test(value))throw Error('Nome inválido (1–60 caracteres)');return value.trim();}
function itemId(value){if(typeof value!=='string'||!ITEM_ID.test(value))throw Error('Identificador de item inválido');return value;}
function normalizeProfileConfig(value){
 object(value,['farm','targetCase','itemRules','destinations']);if(!Object.keys(value).length)throw Error('O perfil precisa de configuração');
 const result={};
 if(Object.hasOwn(value,'farm')){object(value.farm,['case','money','vault']);if(!Object.keys(value.farm).length||Object.values(value.farm).some(v=>typeof v!=='boolean'))throw Error('Modos de farm inválidos');result.farm={...value.farm};}
 if(Object.hasOwn(value,'targetCase'))result.targetCase=value.targetCase===null?null:itemId(value.targetCase);
 if(Object.hasOwn(value,'itemRules')){
  if(!Array.isArray(value.itemRules)||value.itemRules.length>500)throw Error('Regras inválidas');
  result.itemRules=value.itemRules.map(rule=>{
   object(rule,['id','name','action','conditions','destinationAccountId','storageUnitId']);
   if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>130||/[\x00-\x1f]/.test(rule.name)||!['sell','keep','storage'].includes(rule.action))throw Error('Regra inválida');
   const next={name:rule.name.trim(),action:rule.action};if(Object.hasOwn(rule,'id')){if(typeof rule.id!=='string'||!rule.id||rule.id.length>80)throw Error('Identificador de regra inválido');next.id=rule.id;}
   if(rule.conditions!==undefined){
    const c=object(rule.conditions,['floatMin','floatMax','patterns','statTrak','souvenir','eventName','topN']);next.conditions={};
    for(const [key,v] of Object.entries(c)){
     if(['floatMin','floatMax'].includes(key)&&(!Number.isFinite(v)||v<0||v>1))throw Error('Float inválido');
     if(['statTrak','souvenir'].includes(key)&&typeof v!=='boolean')throw Error('Variante inválida');
     if(key==='patterns'&&(!Array.isArray(v)||!v.length||v.length>100||v.some(p=>typeof p!=='string'||!p.trim()||p.length>40||/[\x00-\x1f]/.test(p))))throw Error('Patterns inválidos');
     if(key==='eventName'&&(typeof v!=='string'||!v.trim()||v.length>130||/[\x00-\x1f]/.test(v)))throw Error('Evento inválido');
     if(key==='topN'&&(!Number.isSafeInteger(v)||v<1||v>1e7))throw Error('Ranking inválido');
     next.conditions[key]=copy(v);
    }
    if(c.floatMin!==undefined&&c.floatMax!==undefined&&c.floatMin>c.floatMax)throw Error('Intervalo de float inválido');
   }
   if(rule.action==='storage'){next.destinationAccountId=identifier(rule.destinationAccountId);next.storageUnitId=itemId(rule.storageUnitId);}
   else if(rule.destinationAccountId!==undefined||rule.storageUnitId!==undefined)throw Error('Destino inesperado');
   return next;
  });
 }
 if(Object.hasOwn(value,'destinations')){
  if(!Array.isArray(value.destinations)||value.destinations.length>100)throw Error('Destinos inválidos');
  result.destinations=value.destinations.map(destination=>{object(destination,['accountId','storageUnitId']);return {accountId:identifier(destination.accountId),...(destination.storageUnitId!==undefined?{storageUnitId:itemId(destination.storageUnitId)}:{})};});
 }
 return result;
}
function normalizeState(value){
 object(value,['version','groups','accountGroups','profiles']);if(value.version!==1)throw Error('Versão do workspace local desconhecida');
 if(!Array.isArray(value.groups)||value.groups.length>100||!Array.isArray(value.profiles)||value.profiles.length>100)throw Error('Workspace local inválido');
 const groups=value.groups.map(g=>{object(g,['id','name']);return {id:identifier(g.id),name:name(g.name)};});
 for(const key of ['id','name'])if(new Set(groups.map(g=>g[key].toLocaleLowerCase('pt-PT'))).size!==groups.length)throw Error('Grupos duplicados');
 const accountGroups={};object(value.accountGroups,Object.keys(value.accountGroups||{}));for(const [id,groupId] of Object.entries(value.accountGroups)){identifier(id);if(!groups.some(g=>g.id===groupId))throw Error('Grupo inexistente');accountGroups[id]=groupId;}
 if(Object.keys(accountGroups).length>100)throw Error('Demasiadas associações');
 const profiles=value.profiles.map(p=>{object(p,['id','name','config']);return {id:identifier(p.id),name:name(p.name),config:normalizeProfileConfig(p.config)};});
 for(const key of ['id','name'])if(new Set(profiles.map(p=>p[key].toLocaleLowerCase('pt-PT'))).size!==profiles.length)throw Error('Perfis duplicados');
 return {version:1,groups,accountGroups,profiles};
}
function createAccountWorkspace({load,save,listAccounts,idFactory=randomUUID}){
 let value,readyPromise,tail=Promise.resolve();
 async function ready(){
  if(!readyPromise)readyPromise=(async()=>{const saved=await load();const next=saved==null?{version:1,groups:['Farmer','Trader','Storage','Principal'].map(n=>({id:n.toLowerCase(),name:n})),accountGroups:{},profiles:[]}:normalizeState(saved);if(saved==null)await save(copy(next));value=next;})();
  await readyPromise;return copy(value);
 }
 async function accounts(){const entries=await listAccounts();if(!Array.isArray(entries))throw Error('Contas indisponíveis');return new Set(entries.map(a=>identifier(a.id)));}
 async function validDestinations(config){const known=await accounts();for(const id of [...(config.destinations||[]).map(d=>d.accountId),...(config.itemRules||[]).filter(r=>r.action==='storage').map(r=>r.destinationAccountId)])if(!known.has(id))throw Error('A conta de destino já não existe');}
 function mutate(transform){
  const task=tail.catch(()=>{}).then(async()=>{await ready();const next=copy(value);await transform(next);const clean=normalizeState(next);await save(copy(clean));value=clean;return copy(value);});tail=task;return task;
 }
 function group(state,id){identifier(id);const found=state.groups.find(g=>g.id===id);if(!found)throw Error('Grupo não encontrado');return found;}
 const api={
  ready,async read(){await ready();await tail.catch(()=>{});return copy(value);},
  createGroup(payload){return mutate(state=>{object(payload,['name']);state.groups.push({id:identifier(idFactory()),name:name(payload.name)});});},
  updateGroup(payload){return mutate(state=>{object(payload,['id','name']);group(state,payload.id).name=name(payload.name);});},
  deleteGroup(payload){return mutate(state=>{object(payload,['id']);group(state,payload.id);state.groups=state.groups.filter(g=>g.id!==payload.id);for(const [id,g]of Object.entries(state.accountGroups))if(g===payload.id)delete state.accountGroups[id];});},
  reorderGroups(payload){return mutate(state=>{object(payload,['groupIds']);const ids=payload.groupIds;if(!Array.isArray(ids)||ids.length!==state.groups.length||new Set(ids).size!==ids.length)throw Error('Ordem de grupos inválida');state.groups=ids.map(id=>group(state,id));});},
  assignAccounts(payload){return mutate(async state=>{object(payload,['groupId','accountIds']);if(payload.groupId!==null)group(state,payload.groupId);const ids=payload.accountIds,known=await accounts();if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!known.has(id)))throw Error('Seleciona contas válidas e diferentes');for(const id of ids){if(payload.groupId===null)delete state.accountGroups[id];else state.accountGroups[id]=payload.groupId;}});},
  async selectGroup(payload){object(payload,['groupId']);const state=await api.read();if(payload.groupId!==null)group(state,payload.groupId);const known=await accounts();return {groupId:payload.groupId,accountIds:[...known].filter(id=>(state.accountGroups[id]??null)===payload.groupId)};},
  saveProfile(payload){return mutate(async state=>{object(payload,['id','name','config']);const config=normalizeProfileConfig(payload.config);await validDestinations(config);const next={id:payload.id===undefined?identifier(idFactory()):identifier(payload.id),name:name(payload.name),config};const at=state.profiles.findIndex(p=>p.id===next.id);if(payload.id!==undefined&&at<0)throw Error('Perfil não encontrado');if(at<0)state.profiles.push(next);else state.profiles[at]=next;});},
  deleteProfile(payload){return mutate(state=>{object(payload,['id']);identifier(payload.id);if(!state.profiles.some(p=>p.id===payload.id))throw Error('Perfil não encontrado');state.profiles=state.profiles.filter(p=>p.id!==payload.id);});},
  async loadProfile(payload){object(payload,['id']);identifier(payload.id);const state=await api.read(),profile=state.profiles.find(p=>p.id===payload.id);if(!profile)throw Error('Perfil não encontrado');await validDestinations(profile.config);return copy(profile);},
 };
 return api;
}
module.exports={createAccountWorkspace,normalizeProfileConfig};
