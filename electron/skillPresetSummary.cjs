const {MAP_NAMES,number}=require('./progressionData.cjs');
const EFFECT_FIELDS={11:'moneyPerClick',13:'vaultCapacity',14:'vaultMoneyPerMinute',15:'casesPerClick',17:'caseOpenCount',20:'maxCaseOpenMultiplier'};
function bonuses(nodes){const total={};for(const node of nodes)for(const raw of node.rewards){const parts=raw.split(';'),type=Number(parts[0]),amount=Number(parts[1]);if(parts.length!==2||!parts[1]?.trim()||!Number.isFinite(type)||!Number.isFinite(amount))continue;total[type]=Math.round(((total[type]||0)+amount)*1e6)/1e6;}return total;}
function summarizePresets(presets,states,profile){
 if(states.length!==MAP_NAMES.length||new Set(states.map(s=>s.map.name)).size!==MAP_NAMES.length)throw Error('Faltam mapas para comparar os presets.');
 const reference=states[0],owned=new Set(reference.ownedIds),catalog=new Map();
 for(const state of states){if(JSON.stringify([...state.ownedIds].sort())!==JSON.stringify([...owned].sort()))throw Error('Skills alteradas durante a leitura. Atualiza os presets.');for(const node of state.map.skills){if(catalog.has(node.id))throw Error('ID de skill duplicado entre mapas');catalog.set(node.id,{node,state});}}
 for(const id of owned)if(!catalog.has(id))throw Error('Skills possuídas indisponíveis nos mapas atuais.');
 const ownedBonuses=bonuses([...owned].map(id=>catalog.get(id).node));
 return presets.map(preset=>{
  if(preset.resetOnly)return {...preset};
  const ids=[...new Set(preset.skillIds)],missing=ids.filter(id=>!catalog.has(id));
  if(missing.length)return {...preset,summary:{available:false,reason:'Habilidades do preset indisponíveis nos mapas atuais.'}};
  const desired=new Set(ids),nodes=ids.map(id=>catalog.get(id).node),needed=ids.filter(id=>!owned.has(id)),warnings=[];
  const visit=(id,path=new Set())=>{if(path.has(id))throw Error('Dependência cíclica no mapa atual.');const parent=catalog.get(id)?.node.requiredPrevSkillId;if(parent){if(!desired.has(parent))throw Error('Falta uma dependência no preset atual: '+parent);visit(parent,new Set([...path,id]));}};
  try{for(const id of ids)visit(id);}catch(error){return {...preset,summary:{available:false,reason:error.message}};}
  const maps=MAP_NAMES.filter(name=>ids.some(id=>catalog.get(id).state.map.name===name));
  for(const name of maps){const state=states.find(s=>s.map.name===name);if(!state.map.rankRequirementOptional&&(state.map.requiredRankId===null||state.rank===null||state.rank<state.map.requiredRankId))warnings.push('Nível insuficiente ou indisponível em '+name+'.');if(state.map.requiredPremierId!==null&&state.map.requiredPremierId!==undefined&&(state.premierRank===null||state.premierRank<state.map.requiredPremierId))warnings.push('Requisito Premier em '+name+'.');}
  const totalCost=nodes.reduce((n,s)=>n+s.cost,0),missingCost=needed.reduce((n,id)=>n+catalog.get(id).node.cost,0),effects=bonuses(nodes),added=bonuses(needed.map(id=>catalog.get(id).node));
  const projection=delta=>Object.fromEntries(Object.entries(EFFECT_FIELDS).map(([type,field])=>{const value=number(profile[field])===null?null:Math.round((profile[field]+(delta[type]||0))*1e6)/1e6;return [field,value!==null&&value>=0?value:null];}));
  const resetDelta=Object.fromEntries(Object.keys(EFFECT_FIELDS).map(type=>[type,(effects[type]||0)-(ownedBonuses[type]||0)]));
  const resourcesKnown=number(profile.money)!==null&&Number.isSafeInteger(profile.skillPoints)&&profile.skillPoints>=0;
  return {...preset,summary:{available:true,totalCost,totalPoints:ids.length,missingCost,missingPoints:needed.length,alreadyOwned:ids.length-needed.length,bonuses:effects,maps,warnings,
   canAdd:resourcesKnown&&profile.money>=missingCost&&profile.skillPoints>=needed.length&&!warnings.length,
   projection:{add:projection(added),reset:projection(resetDelta)},current:{money:number(profile.money),skillPoints:number(profile.skillPoints)},
   ownedPoints:owned.size,resetRefund:[...owned].reduce((n,id)=>n+catalog.get(id).node.cost/2,0)}};
 });
}
module.exports={bonuses,summarizePresets};
