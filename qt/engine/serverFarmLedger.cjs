const fs=require('node:fs');const path=require('node:path');const {safeEvent}=require('./export.cjs');
const {emptyPerformance,cleanPerformance,recordPerformance,performanceFor}=require('./farmPerformance.cjs');
const empty=()=>({case:0,money:0,vault:0,confirmedRequests:0,unconfirmedRequests:0});
function createServerLedger(directory,{checkpointEvery=1024,now=Date.now}={}){
 if(!Number.isSafeInteger(checkpointEvery)||checkpointEvery<1)throw TypeError('Intervalo de registo inválido');
 const file=path.join(directory,'results.json'),journal=path.join(directory,'results.journal');let value={sequence:0,accounts:{},events:[],performance:emptyPerformance(now())},pending=0;
 function checkpoint(){const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);
  const parent=fs.openSync(directory,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}fs.writeFileSync(journal,'',{mode:0o600});pending=0;
 }
 function apply(event){recordPerformance(value.performance,event,now());value.sequence=event.sequence;value.events.push(event);if(value.events.length>5000)value.events.shift();
   if(['request','vault'].includes(event.type)){
    const total=value.accounts[event.accountId] ||= empty();const kind=event.type==='vault'?'vault':event.kind;const delta=event.type==='vault'?event.confirmedDelta:event.verifiedDelta;
    if(event.httpStatus===200&&Number.isFinite(delta)&&delta>0){if(['case','money','vault'].includes(kind))total[kind]+=delta;total.confirmedRequests++;}
    else if(event.httpStatus===200)total.unconfirmedRequests++;
   }
 }
 return {async ready(){try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(value.performance)value.performance=cleanPerformance(value.performance,now());else {const dates=value.events.map(e=>Date.parse(e.at)).filter(at=>Number.isFinite(at)&&at<=now());value.performance=emptyPerformance(dates.length?Math.min(...dates):now());for(const event of value.events)recordPerformance(value.performance,event,now());}
   let data;try{data=fs.readFileSync(journal);}catch(e){if(e.code==='ENOENT')return;throw e;}
   const end=data.lastIndexOf(10)+1;if(end<data.length)fs.truncateSync(journal,end);
   for(const line of data.subarray(0,end).toString('utf8').split('\n'))if(line){const event=JSON.parse(line);if(event.sequence<=value.sequence)continue;if(event.sequence!==value.sequence+1)throw Error('Sequência do registo interrompida');if(!value.sequence&&Date.parse(event.at)<value.performance.startedAt)value.performance.startedAt=Date.parse(event.at);apply(event);pending++;}
  },
  export(){return structuredClone(value);},
  restore(snapshot){
   if(!snapshot||!Number.isSafeInteger(snapshot.sequence)||snapshot.sequence<0||!snapshot.accounts||typeof snapshot.accounts!=='object'||Array.isArray(snapshot.accounts)||!Array.isArray(snapshot.events)||snapshot.events.length>5000)throw Error('Registo de resultados inválido');
   for(const [id,result] of Object.entries(snapshot.accounts)){if(!/^[a-zA-Z0-9-]{1,128}$/.test(id)||Object.keys(empty()).some(key=>!Number.isFinite(result?.[key])||result[key]<0))throw Error('Resultados de conta inválidos');}
   const performance=cleanPerformance(snapshot.performance,now());value=structuredClone(snapshot);value.performance=performance;value.events=value.events.map(event=>({...safeEvent(event),sequence:event.sequence}));checkpoint();
  },
  async reset(){value={sequence:value.sequence+1,accounts:{},events:[],performance:emptyPerformance(now())};checkpoint();},
  record(raw){const event={...safeEvent(raw),sequence:value.sequence+1};fs.appendFileSync(journal,JSON.stringify(event)+'\n',{mode:0o600});if(!value.sequence&&Date.parse(event.at)<value.performance.startedAt)value.performance.startedAt=Date.parse(event.at);apply(event);pending++;
   // Journal first: an interrupted checkpoint can be replayed without
   // counting awards twice. Only checkpointing rewrites the bounded history.
   if(pending>=checkpointEvery)checkpoint();return event;
  },flush:checkpoint,performance(id){return performanceFor(value.performance,id,now());},results(id){return {...(value.accounts[id]||empty())};},events(after=0){return value.events.filter(e=>e.sequence>after);},sequence(){return value.sequence;}
 };
}
module.exports={createServerLedger};
