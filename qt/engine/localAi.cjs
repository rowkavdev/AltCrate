const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const MOVES = ['hit','stand','double','split'];
function sanitizeDecision(input) {
  const valid=rank=>typeof rank==='string'&&/^(10|[2-9AJQK])$/.test(rank);
  if(!Array.isArray(input?.cards)||input.cards.length<2||input.cards.length>11||!input.cards.every(valid)||!valid(input.dealer))throw new Error('Cartas inválidas para a IA local.');
  const cards=[...input.cards],value=r=>['10','J','Q','K'].includes(r)?10:r;
  const canDouble=input.canDouble===true&&cards.length===2;
  return {cards,dealer:input.dealer,canDouble,canSplit:canDouble&&input.canSplit===true&&value(cards[0])===value(cards[1])};
}
function validateAnswer(answer,state) {
  const legal=MOVES.filter(move=>move!=='double'&&move!=='split'||move==='double'&&state.canDouble||move==='split'&&state.canSplit);
  const probabilities=Object.fromEntries(legal.map(move=>[move,answer?.probabilities?.[move]]));
  const values=Object.values(probabilities);
  if(!legal.includes(answer?.move)||Object.keys(answer?.probabilities||{}).length!==legal.length||values.some(p=>!Number.isFinite(p)||p<0||p>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>.002||probabilities[answer.move]<Math.max(...values)||!Number.isFinite(answer.latencyMs)||answer.latencyMs<0)throw new Error('A IA local devolveu uma decisão inválida.');
  return {move:answer.move,probabilities,latencyMs:Math.round(answer.latencyMs),model:'laya-typed-decisions-mlx'};
}
function createLocalAi({directory,spawnWorker=spawn,exists=fs.existsSync,requestTimeoutMs=2200}={}) {
  let child=null,phase='idle',message='',ready=null,sequence=0,cancelStartup=null;
  const pending=new Map();
  const status=()=>{
    let validation=null;
    try{const value=JSON.parse(fs.readFileSync(path.join(directory,'validation.json'),'utf8'));if(['cases','agreement','p50Ms'].every(key=>Number.isFinite(value[key]))&&value.cases>0&&value.agreement>=0&&value.agreement<=value.cases)validation={cases:value.cases,agreement:value.agreement,p50Ms:value.p50Ms,...(Number.isFinite(value.validatedAgreement)&&value.validatedAgreement>=0&&value.validatedAgreement<=value.cases?{validatedAgreement:value.validatedAgreement}:{})};}catch{}
    return {phase,message,model:'Laya-MLX · local',validation};
  };
  function fail(error) {
    phase='error';message=error.message;
    cancelStartup?.(error);cancelStartup=null;
    const old=child;child=null;
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();
    old?.kill();
  }
  return {
    status,
    prepare() {
      if(phase==='ready')return Promise.resolve(status());
      if(phase==='loading')return ready;
      const python=path.join(directory,'venv','bin','python'),model=path.join(directory,'model');
      if(!exists(python)||!exists(path.join(model,'model.safetensors'))){phase='missing';message='O modelo local ainda não está instalado neste Mac.';return Promise.reject(new Error(message));}
      phase='loading';message='A carregar o modelo local…';
      ready=new Promise((resolve,reject)=>{
        let started=false;
        const timer=setTimeout(()=>{const error=new Error('O modelo local demorou demasiado a carregar.');fail(error);reject(error);},45000);
        cancelStartup=error=>{clearTimeout(timer);reject(error);};
        try {
          child=spawnWorker(python,['-u','-c',fs.readFileSync(path.join(__dirname,'local_ai_worker.py'),'utf8'),model],{stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TOKENIZERS_PARALLELISM:'false'}});
          const launched=child;
          // Drain diagnostics without exporting paths, credentials or raw model data.
          launched.stderr.on('data',()=>{});
          createInterface({input:launched.stdout}).on('line',line=>{
            if(child!==launched)return;
            let response;try{response=JSON.parse(line);}catch{return;}
            if(response.type==='ready'){started=true;clearTimeout(timer);cancelStartup=null;phase='ready';message='Modelo carregado · decisões neste Mac';resolve(status());return;}
            if(response.type==='error'){const error=new Error('Não foi possível carregar o modelo local.');clearTimeout(timer);fail(error);reject(error);return;}
            const item=pending.get(response.id);if(!item)return;
            clearTimeout(item.timer);pending.delete(response.id);
            try {if(response.error)throw new Error('Falha na decisão da IA local.');item.resolve(validateAnswer(response,item.state));}catch(error){item.reject(error);}
          });
          launched.on('error',()=>{clearTimeout(timer);const error=new Error('Não foi possível iniciar a IA local.');if(child===launched)fail(error);reject(error);});
          launched.on('exit',()=>{clearTimeout(timer);if(child!==launched)return;const error=new Error('A IA local terminou.');fail(error);if(!started)reject(error);});
        } catch(error){clearTimeout(timer);fail(new Error('Não foi possível iniciar a IA local.'));reject(error);}
      });
      return ready;
    },
    async predict(input) {
      const state=sanitizeDecision(input);
      if(phase!=='ready'||!child)throw new Error('A IA local não está pronta.');
      if(pending.size>=20)throw new Error('A IA local está ocupada.');
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>fail(new Error('A IA local demorou demasiado; foi usada a estratégia básica.')),requestTimeoutMs);
        pending.set(id,{resolve,reject,timer,state});
        child.stdin.write(JSON.stringify({id,state})+'\n',error=>{if(error)fail(new Error('Ligação à IA local interrompida.'));});
      });
    },
    dispose(){cancelStartup?.(new Error('IA local desligada.'));cancelStartup=null;const old=child;child=null;for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('IA local desligada.'));}pending.clear();old?.kill();phase='idle';},
  };
}
module.exports={createLocalAi,sanitizeDecision,validateAnswer};
