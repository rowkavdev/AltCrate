import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import RewardsPage from '../src/pages/RewardsPage.jsx';
import SkillMapsPage from '../src/pages/SkillMapsPage.jsx';
import DiagnosticsPage from '../src/pages/DiagnosticsPage.jsx';
import SiteAutoOpenPage from '../src/pages/SiteAutoOpenPage.jsx';
import '../src/styles.css';
const accounts=[{id:'a',label:'Conta A'},{id:'b',label:'Conta B'}];
const checks=[],failures=[];let root;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
const waitFor=async(predicate,message)=>{for(let index=0;index<400;index++){if(predicate())return;await pause(10);}throw new Error('Timeout: '+message);};
const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
function mount(Page,bridge){if(root)root.unmount();root=createRoot(document.querySelector('#root'));function Harness(){const [ui,setUi]=useState({accountId:'a'});return <Page model={{accounts,bridge}} ui={ui} onUiChange={patch=>setUi(previous=>({...previous,...patch}))}/>;}root.render(<Harness/>);}
const rewardData=(accountId,title)=>({accountId,tracks:[{key:'money',id:14.71,title,description:'Dinheiro por clique +1',current:4,target:5,progress:.8,eligible:true}],readAt:1000});
window.runProgressionChecks=async()=>{
 const run=async(name,work)=>{try{await work();checks.push(name);}catch(error){failures.push(name+': '+error.message);}};
 await run('late account read ignored',async()=>{
  let releaseA;mount(RewardsPage,{readRewards:id=>id==='a'?new Promise(resolve=>releaseA=resolve):Promise.resolve(rewardData(id,'Recompensa B'))});
  await waitFor(()=>releaseA&&document.querySelector('select'),'initial account read');const select=document.querySelector('select');select.value='b';select.dispatchEvent(new Event('change',{bubbles:true}));
  await waitFor(()=>document.querySelector('#root').textContent.includes('Recompensa B'),'account B reward');releaseA(rewardData('a','Recompensa A'));await pause(80);assert(!document.querySelector('#root').textContent.includes('Recompensa A'),'late response overwrote selected account');
 });
 await run('claim all sends every reward type once and refreshes the account',async()=>{
  let sends=0,reads=0,scans=0,release,listener;
  const claims=['reward','mission','pass','pass'].map((kind,i)=>({accountId:'a',label:'Conta A',kind,title:'Recolha '+i,eligible:true,payload:kind==='reward'?{id:1.25}:kind==='mission'?{id:'daily'}:{tier:1,track:i===2?'free':'premium'}}));
  const rows=claims.map((item,i)=>({rowId:String(i),accountId:'a',accountLabel:'Conta A',kind:item.kind,title:item.title,state:'ready'}));
  const batch={batchId:'all',phase:'review',rows};
  mount(RewardsPage,{readRewards:async()=>{reads++;return rewardData('a','Recompensa A');},progressionBatchStatus:async()=>({phase:'idle',rows:[]}),onEvent:fn=>{listener=fn;return()=>{};},discoverProgressionBatch:async input=>{assert(input.accountIds.join(',')==='a','wrong account scope');assert(input.kinds.join(',')==='reward,mission,pass','missing reward types');return ++scans===1?claims:[];},prepareProgressionBatch:async input=>{assert(input.actions.length===4,'missing eligible claims');return batch;},confirmProgressionBatch:async()=>{sends++;listener({type:'progression-batch',batch:{...batch,phase:'running'}});return new Promise(resolve=>release=resolve);}});
  await waitFor(()=>button('Resgatar todas')&&!button('Resgatar todas').disabled,'claim button');button('Resgatar todas').click();
  await waitFor(()=>release&&button('Parar resgate'),'one-click execution');assert(sends===1,'duplicate confirmations');assert(button('A resgatar…').disabled,'repeat click enabled');assert(button('Rever recompensa').disabled,'individual claim enabled during batch');
  release({...batch,phase:'completed',rows:rows.map(row=>({...row,state:'confirmed'}))});
  await waitFor(()=>document.querySelector('[role=status]')?.textContent.includes('4'),'claim count');await waitFor(()=>reads===2,'account refreshed');assert(scans===2,'unlocked rewards not checked');
 });
 let writes=0,stops=0,releaseConfirm,state='idle';
 const bridge={readSkillMap:async id=>({accountId:id,map:{name:'Dust II',image:null,requiredRankId:1,skills:[{id:'a1',name:'Habilidade A',cost:50,rewards:['11;1'],requiredPrevSkillId:null,nextSkillIds:[],waypointX:50,waypointY:40}]},ownedIds:[],money:100,skillPoints:2,rank:2,readAt:1000}),listSkillPresets:async()=>[],prepareProgression:async accountId=>({previewId:'preview-a',accountId,kind:'skill-buy',title:'Comprar habilidade',cost:50,pointCost:1,steps:[{kind:'skill-buy',name:'Habilidade A',mapName:'Dust II'}],warnings:[]}),confirmProgression:()=>{writes++;state='running';return new Promise(resolve=>releaseConfirm=resolve);},progressionStatus:async()=>({state,completed:0,total:1,message:state==='running'?'A aplicar habilidade…':state==='stopped'?'Parada.':'Pronta.'}),stopProgression:async()=>{stops++;state='stopped';releaseConfirm({operationId:'op-a',state:'stopped',verified:false,message:'Sequência parada.'});return {state:'stopped',message:'Sequência parada.'};},verifyProgression:async()=>({operationId:'op-a',state:'confirmed',verified:true,message:'Resultado verificado.'})};
 mount(SkillMapsPage,bridge);
 await run('dialog traps focus and Escape closes review',async()=>{
  await waitFor(()=>button('Rever compra'),'loaded skill');button('Rever compra').click();await waitFor(()=>document.querySelector('[role=dialog]'),'prepared dialog');assert(writes===0,'preparation performed mutation');
  const controls=[...document.querySelector('[role=dialog]').querySelectorAll('button:not(:disabled)')],first=controls[0],last=controls.at(-1);last.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert(document.activeElement===first,'Tab escaped dialog');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert(document.activeElement===last,'Shift Tab escaped dialog');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await waitFor(()=>!document.querySelector('[role=dialog]'),'Escape closes review');assert(writes===0,'Escape confirmed an action');
 });
 await run('confirmation can be stopped while awaiting response',async()=>{
  button('Rever compra').click();await waitFor(()=>button('Confirmar alteração'),'review again');button('Confirmar alteração').click();await waitFor(()=>button('Parar sequência'),'stop offered while awaiting confirmation');assert(!document.querySelector('[role=dialog]'),'dialog blocked stop');assert(writes===1,'unexpected mutation count');assert(!button('Parar sequência').disabled,'stop was disabled by pending confirmation');button('Parar sequência').click();await waitFor(()=>stops===1&&button('Verificar resultado'),'stop delivered');button('Verificar resultado').click();await waitFor(()=>button('Atualizar')&&!button('Atualizar').disabled,'pending cleared after verified refresh');assert(stops===1,'multiple stop calls');
 });
 await run('failed read can be retried',async()=>{
  let attempts=0;mount(DiagnosticsPage,{readDiagnostics:async accountId=>{attempts++;if(attempts===1)throw new Error('Consulta indisponível na fixture.');return {accountId,before:null,after:{money:200,observedAt:2000},changes:[],readAt:2000};}});
  await waitFor(()=>document.querySelector('[role=alert]'),'visible read failure');assert(!button('Atualizar').disabled,'error permanently disabled refresh');button('Atualizar').click();await waitFor(()=>document.querySelector('#root').textContent.includes('Dinheiro virtual'),'retried read');assert(attempts===2,'retry did not read account');
 });
 root?.unmount();return {checks,failures};
};

window.runProgressionLayoutChecks=async width=>{
 const config={favoriteLowFloats:true,favoriteHighFloats:false,favoriteCustomFloats:false,favoritePatterns:true,autosellActivated:false,autosellAmount:2,autosellVariant:'money',customLowFloat:0.01,customHighFloat:0.99,customSelectedFloats:[0.25],patternBlacklist:['Padrão de teste']};
 const map={accountId:'a',map:{name:'Dust II',image:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="700" height="400"><rect width="700" height="400" fill="%23152035"/></svg>',requiredRankId:1,skills:[{id:'a1',name:'Habilidade longa para verificar o mapa e a lista',cost:50,rewards:['11;1'],requiredPrevSkillId:null,nextSkillIds:[],waypointX:50,waypointY:40}]},ownedIds:[],money:100,skillPoints:2,rank:2,readAt:1000};
 const bridge={readRewards:async()=>rewardData('a','Recompensa com requisito e efeito observado'),readSkillMap:async()=>map,listSkillPresets:async()=>[],readAutoOpen:async()=>({accountId:'a',config,presets:[],activePresetId:null,readAt:1000}),readDiagnostics:async()=>({accountId:'a',before:{money:10,observedAt:1000},after:{money:20,observedAt:2000},changes:[{field:'money',before:10,after:20}],readAt:2000})};
 const outcomes=[];
 for(const [name,Page,selector] of [['rewards',RewardsPage,'.reward-card'],['skills',SkillMapsPage,'.skill-map-image'],['autoopen',SiteAutoOpenPage,'.autoopen-fields'],['diagnostics',DiagnosticsPage,'.diagnostic-observations']]){
  mount(Page,bridge);await waitFor(()=>document.querySelector(selector),'layout loaded '+name);await pause(30);const overflow=document.documentElement.scrollWidth>innerWidth+1;outcomes.push({name,width:innerWidth,overflow});if(name==='skills')assert(document.querySelector('.skill-map-scroll').scrollWidth>=700,'map not independently scrollable');
 }
 root?.unmount();return outcomes;
};
