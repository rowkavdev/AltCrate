const MAP_NAMES=Object.freeze(['Dust II','Mirage','Inferno','Ancient','Anubis','Cobblestone']);
const CONFIG_BOOLEAN=Object.freeze(['favoriteLowFloats','favoriteHighFloats','favoriteCustomFloats','favoritePatterns','autosellActivated']);
const CONFIG_FIELDS=Object.freeze([...CONFIG_BOOLEAN,'autosellAmount','autosellVariant','customLowFloat','customHighFloat','customSelectedFloats','patternBlacklist']);
// Public client decoder: /_next/static/chunks/pages/rewards-4ee732c550d4b13e.js (read-only 2026-10-14).
const EFFECTS={1:'Dinheiro virtual',2:'Facas aleatórias',3:'Skins azuis aleatórias',4:'Skins roxas aleatórias',5:'Skins rosas aleatórias',6:'Skins vermelhas aleatórias',7:'Skin específica',8:'Aberturas gratuitas de caixa',10:'Tokens',11:'Dinheiro por clique',12:'Experiência',13:'Capacidade do cofre',14:'Geração do cofre por minuto',15:'Pontos percentuais de caixas por clique',16:'Capacidade do inventário',17:'Máximo de aberturas',18:'Máximo de storages',19:'Preço máximo da caixa',20:'Multiplicador de abertura',21:'Desbloquear pacote de batalhas de caixas',22:'Desbloquear membro Pro',23:'Desbloquear pacote de storage',24:'Efeitos especiais aleatórios',25:'Munições',31:'Bilhetes de evento',32:'Créditos da Armory',33:'Terminais selados'};
const REQUIREMENTS={requiredRankId:{label:'Rank'},requiredPremierId:{label:'Classificação Premier'},requiredVaultCapacity:{label:'Capacidade do cofre'},requiredOpenedCases:{counter:'openedCases',label:'Caixas abertas'},requiredInventoryValue:{counter:'inventoryValue',label:'Valor do inventário'},requiredCoinflips:{counter:'coinflips',label:'Coinflips jogados'},requiredUpgrades:{counter:'upgrades',label:'Upgrades realizados'},requiredCasebattles:{counter:'casebattles',label:'Batalhas de caixas jogadas'},requiredMembershipTime:{counter:'membership',label:'Dias como membro'},requiredClicks:{counter:'clicks',label:'Cliques'},requiredJackpots:{counter:'jackpots',label:'Jackpots jogados'},requiredTradeUps:{counter:'tradeUps',label:'Trade-ups realizados'},requiredSkinCollections:{counter:'skinCollections',label:'Coleções de skins'},requiredDices:{counter:'dices',label:'Jogadas de dados'},requiredMissions:{counter:'missions',label:'Missões concluídas'},requiredGuessTheRanks:{counter:'guessTheRanks',label:'Rondas de adivinhar o rank'},requiredBlackjacks:{counter:'blackjacks',label:'Rondas de blackjack'},requiredPlinkos:{counter:'plinkos',label:'Jogadas de Plinko'},requiredCrashes:{counter:'crashes',label:'Rondas de Crash'}};
const REWARD_TITLES={Rank:'Rank',Premier:'Classificação Premier',Vault:'Cofre',OpenedCases:'Caixas abertas',InventoryValue:'Valor do inventário',Coinflip:'Coinflip',Coinflips:'Coinflip',Upgrade:'Upgrades',Upgrades:'Upgrades',Casebattle:'Batalhas de caixas',Casebattles:'Batalhas de caixas',MembershipTime:'Tempo de membro',Click:'Cliques',Jackpot:'Jackpot',TradeUp:'Trade-ups',SkinCollection:'Coleções de skins',Dice:'Dados',Dices:'Dados',Mission:'Missões',GuessTheRank:'Adivinhar o rank',Blackjack:'Blackjack',Plinko:'Plinko',Crash:'Crash'};
REQUIREMENTS.requiredVaultMoneyCollected={counter:'vaultMoneyCollected',label:'Dinheiro virtual recolhido do cofre'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=(value,max=180)=>typeof value==='string'?value.slice(0,max):'';
const skillId=value=>typeof value==='string'&&/^[a-f]\d{1,4}$/.test(value);
function rankOf(me){const value=object(me?.rank)?me.rank.id:me?.rank;return Number.isSafeInteger(value)&&value>=0?value:null;}
function effect(value){const code=text(String(value)),[type,amount,...parameters]=code.split(';'),numeric=value=>typeof value==='string'&&value.trim()?number(Number(value)):null;return {code,type:numeric(type),amount:numeric(amount),parameters,description:EFFECTS[type]?EFFECTS[type]+(parameters.length?' · '+parameters.join(';'):''):'Efeito desconhecido ('+code+')'};}
function normalizeRewards(body){
 if(!object(body))throw Error('Resposta inválida das recompensas');
 const entries=Object.entries(body).filter(([key])=>/^next.*Reward$/.test(key));if(!entries.length)throw Error('Recompensas indisponíveis: resposta sem tracks');
 return entries.map(([key,entry])=>{
  const name=key.replace(/^next/,'').replace(/Reward$/,''),title=REWARD_TITLES[name]||name.replace(/([a-z])([A-Z])/g,'$1 $2');
  if(entry===null)return {key,title,id:null,eligible:false,complete:true,description:'Sem próxima recompensa',requirement:null,current:null,target:null,progress:null};
  if(!object(entry)||!object(entry.reward)||number(entry.reward.id)===null||entry.reward.id<0||typeof entry.isRedeemable!=='boolean')throw Error('Resposta inválida das recompensas');
  const required=Object.entries(entry.reward).filter(([k,v])=>k.startsWith('required')&&k!=='requiredPrevRewardId'&&number(v)!==null);
  const fallbackCurrent=Object.entries(entry).filter(([k,v])=>k.startsWith('current')&&number(v)!==null);
  const requirement=required.map(([field,target])=>{const definition=REQUIREMENTS[field],counter=definition?.counter,current=counter?number(entry[counter]):null;return {field,target,label:definition?.label||'Objetivo indicado pelo servidor',current};});
  const target=required.length===1?required[0][1]:null,observed=requirement.length===1?requirement[0].current:null,amount=observed!==null?observed:fallbackCurrent.length===1?fallbackCurrent[0][1]:null;
  const raw=text(entry.reward.rewardString,500);
  return {key,title,id:entry.reward.id,eligible:entry.isRedeemable,complete:false,description:raw?raw.split(',').map(v=>{const e=effect(v);return e.description+(e.amount!==null?' +'+e.amount:'');}).join(' · '):'Efeito indisponível',effects:raw?raw.split(',').map(effect):[],requirement,current:amount,target,progress:amount!==null&&target>0?Math.min(1,Math.max(0,amount/target)):null};
 });
}
function normalizeMap(pageProps,mapName,me){
 if(!MAP_NAMES.includes(mapName))throw Error('Mapa inválido');
 const parse=value=>{if(typeof value==='string'){try{return JSON.parse(value);}catch{throw Error('Resposta inválida do mapa');}}return value;};
 const raw=parse(pageProps?.skillmap),ids=parse(pageProps?.skillIds);
 if(!object(raw)||!Array.isArray(raw.skills)||raw.skills.length>1000||!Array.isArray(ids)||ids.length>2000||ids.some(id=>!skillId(id)))throw Error('Resposta inválida do mapa ou skills possuídas');
 const ownedIds=[...new Set(ids)],owned=new Set(ownedIds),rank=rankOf(me),requiredRankId=number(raw.requiredRankId),requiredPremierId=raw.requiredPremierId??null,premierRank=rankOf({rank:me?.premierRank});
 if(requiredRankId!==null&&(!Number.isSafeInteger(requiredRankId)||requiredRankId<0)||requiredPremierId!==null&&(!Number.isSafeInteger(requiredPremierId)||requiredPremierId<0))throw Error('Requisito de nível inválido');
 const rankRequirementOptional=!Object.hasOwn(raw,'requiredRankId')&&Number.isSafeInteger(requiredPremierId)&&requiredPremierId>0;
 const skills=raw.skills.map(s=>{
  if(!object(s)||!skillId(s.id)||number(s.cost)===null||s.cost<0||!(s.requiredPrevSkillId===null||skillId(s.requiredPrevSkillId))||!Array.isArray(s.nextSkillIds)||s.nextSkillIds.some(id=>!skillId(id))||!Array.isArray(s.rewards)||s.rewards.some(v=>typeof v!=='string'))throw Error('Resposta inválida de uma skill');
  const isOwned=owned.has(s.id),available=!isOwned&&(s.requiredPrevSkillId===null||owned.has(s.requiredPrevSkillId))&&(rankRequirementOptional||rank!==null&&requiredRankId!==null&&rank>=requiredRankId)&&(requiredPremierId===null||premierRank!==null&&premierRank>=requiredPremierId);
  return {id:s.id,name:text(s.name)||s.id,cost:s.cost,requiredPrevSkillId:s.requiredPrevSkillId,nextSkillIds:[...s.nextSkillIds],rewards:s.rewards.map(v=>text(v,80)),effects:s.rewards.map(effect),waypointX:number(s.waypointX),waypointY:number(s.waypointY),owned:isOwned,available,locked:!isOwned&&!available};
 });
 if(new Set(skills.map(s=>s.id)).size!==skills.length)throw Error('Resposta inválida: skills duplicadas');
 return {map:{name:mapName,image:media(raw.image||raw.imageUrl),requiredRankId,requiredPremierId,rankRequirementOptional,skills},ownedIds,money:number(me?.money),skillPoints:number(me?.skillPoints),rank,premierRank};
}
function media(value){if(typeof value!=='string')return null;if(value.startsWith('/')&&!value.startsWith('//'))return 'https://case-clicker.com'+value;try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
function parsePage(html){
 if(typeof html!=='string'||html.length>10000000)throw Error('Resposta inválida do mapa');
 const scripts=html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);for(const match of scripts){if(/\bid\s*=\s*["']__NEXT_DATA__["']/i.test(match[1])){try{return JSON.parse(match[2]).props.pageProps;}catch{throw Error('Resposta inválida do mapa');}}}
 throw Error('Mapa indisponível: dados atuais não encontrados');
}
function normalizeConfig(raw,{strict=false}={}){
 if(!object(raw))throw Error('Configuração de auto-open inválida');
 if(strict&&Object.keys(raw).some(key=>!CONFIG_FIELDS.includes(key)))throw Error('Campo de auto-open não permitido');
 const out={};for(const key of CONFIG_FIELDS){const value=raw[key];
  if(CONFIG_BOOLEAN.includes(key)){if(typeof value!=='boolean')throw Error('Configuração de auto-open inválida: '+key);}
  else if(['autosellAmount','customLowFloat','customHighFloat'].includes(key)){if(number(value)===null||value<0||(['customLowFloat','customHighFloat'].includes(key)&&value>1))throw Error('Configuração de auto-open inválida: '+key);}
  else if(key==='autosellVariant'){if(!['money','tokens'].includes(value))throw Error('Variante de auto-open inválida');}
  else if(key==='customSelectedFloats'){if(!Array.isArray(value)||value.length>500||value.some(v=>number(v)===null||v<0||v>1))throw Error('Floats inválidos');}
  else if(!Array.isArray(value)||value.length>500||value.some(v=>typeof v!=='string'||!v||v.length>120))throw Error('Padrões inválidos');
  out[key]=structuredClone(value);
 }if(out.customLowFloat>out.customHighFloat)throw Error('Intervalo de floats inválido');return out;
}
function normalizeAutoOpen(raw,presets){
 if(!object(raw)||!Array.isArray(presets))throw Error('Resposta inválida de auto-open');
 const activePresetId=raw.activePresetId??null;if(activePresetId!==null&&(typeof activePresetId!=='string'||activePresetId.length>100))throw Error('Preset ativo inválido');
 return {config:normalizeConfig(object(raw.config)?raw.config:raw),activePresetId,presets:presets.slice(0,500).map(row=>{
  if(!object(row)||typeof row._id!=='string'||row._id.length>100)throw Error('Preset de auto-open inválido');return {id:row._id,name:text(row.name)||'Preset',config:normalizeConfig(row.config),createdAt:text(row.createdAt,40)||null,updatedAt:text(row.updatedAt,40)||null};
 })};
}
const GOALS={clickedCases:'Cliques para caixas',clickedMoney:'Cliques para dinheiro',openedCases:'Caixas abertas',playedGames:'Jogos realizados',collectedVault:'Recolhas do cofre',playBlackjacks:'Jogar Blackjack',loseCasebattles:'Perder batalhas de caixas','10xPlinko':'Obter pelo menos 10× no Plinko',doClassifiedTradeups:'Trade-ups para skins Classified',playPlinkos:'Jogar Plinko',openCapsules:'Abrir cápsulas',loseJackpots:'Perder Jackpots',winJackpots:'Ganhar Jackpots',doCovertTradeups:'Trade-ups para skins Covert',winCrash:'Ganhar rondas de Crash',openRedSkins:'Abrir skins vermelhas',playJackpots:'Jogar Jackpot',openCollectionCases:'Abrir caixas de coleção'};
function normalizeMissions(rows,pass){
 if(!Array.isArray(rows)||!object(pass))throw Error('Missões ou passe indisponíveis: resposta inválida');
 return {missions:rows.slice(0,1000).map(row=>{
  if(!object(row))throw Error('Missão inválida');const current=number(row.currentAmount),target=number(row.targetAmount);return {id:text(row.id||row._id)||null,goal:text(row.goal),title:GOALS[row.goal]||text(row.goal)||'Missão',description:text(row.description)||GOALS[row.goal]||text(row.goal),current,target,progress:current!==null&&target>0?Math.max(0,Math.min(1,current/target)):null,redeemed:row.redeemed===true,eligible:row.isRedeemable===true,duration:text(row.duration,20),validTill:text(row.validTill,40)};
 }),pass:displayPass(pass)};
}
function displayPass(raw){
 const fields=['period','endsAt','points','tier','level','currentTier','currentLevel','currentPoints','maxTier','maxPoints','pointsToNextTier','totalTiers','pointsPerTier','isPremium','proFreePassAvailable','active','expiresAt','month','year','validTill','startDate','endDate'];const out={};
 for(const key of fields)if(number(raw[key])!==null||typeof raw[key]==='boolean'||typeof raw[key]==='string')out[key]=typeof raw[key]==='string'?text(raw[key],100):raw[key];
 if(Array.isArray(raw.rewards))out.rewards=raw.rewards.slice(0,500).filter(object).map(r=>{const clean={};for(const k of ['id','tier','points','name','description','claimed','redeemed','isRedeemable','rewardString','amount'])if(['string','number','boolean'].includes(typeof r[k]))clean[k]=typeof r[k]==='string'?text(r[k],180):r[k];return clean;});
 for(const key of ['claimedFreeTiers','claimedPremiumTiers','claimableFreeTiers','claimablePremiumTiers'])if(Array.isArray(raw[key]))out[key]=raw[key].slice(0,500).filter(v=>Number.isSafeInteger(v)&&v>=0);
 if(Array.isArray(raw.track))out.track=raw.track.slice(0,500).filter(r=>object(r)&&Number.isSafeInteger(r.tier)&&r.tier>=0).map(r=>({tier:r.tier,freeReward:typeof r.freeReward==='string'?text(r.freeReward,300):null,premiumReward:typeof r.premiumReward==='string'?text(r.premiumReward,300):null,freeEffects:typeof r.freeReward==='string'?r.freeReward.split(',').map(effect):[],premiumEffects:typeof r.premiumReward==='string'?r.premiumReward.split(',').map(effect):[]}));
 if(!Object.keys(out).length)out.unavailable=true;return out;
}
function diagnosticFields(me,cases,observedAt){
 if(!object(me)||!Array.isArray(cases)||cases.some(c=>number(c?.amount)===null))throw Error('Diagnóstico indisponível: resposta inválida');const out={observedAt};
 for(const key of ['money','tokens','skillPoints','inventoryCount','moneyPerClick','casesPerClick','caseOpenCount','maxCaseOpenMultiplier','vaultCapacity','vaultMoneyPerMinute','eventTickets','dailyTradesLeft'])out[key]=number(me[key]);
 out.rank=rankOf(me);out.casesTotal=cases.reduce((sum,c)=>sum+c.amount,0);out.caseKinds=cases.length;out.casesWithStock=cases.filter(c=>c.amount>0).length;return out;
}
function differences(before,after){return Object.keys(after).filter(k=>k!=='observedAt'&&JSON.stringify(before?.[k])!==JSON.stringify(after[k])).map(field=>({field,before:before?.[field]??null,after:after[field]}));}
module.exports={MAP_NAMES,CONFIG_FIELDS,normalizeRewards,normalizeMap,parsePage,normalizeConfig,normalizeAutoOpen,normalizeMissions,diagnosticFields,differences,number,object,skillId};
