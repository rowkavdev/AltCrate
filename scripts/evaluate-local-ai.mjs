import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {blackjackAdvice} from '../src/blackjackAuto.js';
import {validateLocalProposal} from '../src/blackjackEv.js';
const require=createRequire(import.meta.url);
const {createLocalAi}=require('../electron/localAi.cjs');
const directory=path.join(os.homedir(),'Library','Application Support','case-clicker-mac-dashboard','local-ai');
const ai=createLocalAi({directory,requestTimeoutMs:5000});
const card=rank=>({rank:String(rank),suit:'S'});
const moves={'Pedir carta':'hit',Parar:'stand',Dobrar:'double',Dividir:'split'};
const rows=[];
try {
  await ai.prepare();
  for(const kind of ['hard','soft','pair'])for(let value=kind==='hard'?4:kind==='soft'?12:2;value<=(kind==='hard'||kind==='soft'?21:11);value++)for(let dealer=2;dealer<=11;dealer++) {
    const ranks=(kind==='soft'?['A',value===12?'A':value-11]:kind==='pair'?[value===11?'A':value,value===11?'A':value]:value<=11?[2,value-2]:value===21?[10,9,2]:[10,value-10]).map(String);
    const up=dealer===11?'A':String(dealer),canDouble=ranks.length===2,canSplit=kind==='pair';
    const reference=moves[blackjackAdvice({cards:ranks.map(card)},card(up),canDouble,canSplit)];
    const answer=await ai.predict({cards:ranks,dealer:up,canDouble,canSplit});
    const checked=validateLocalProposal({cards:ranks,dealer:up,canDouble,canSplit},reference,answer.move);
    rows.push({kind,cards:ranks,dealer:up,reference,...answer,validatedMove:checked.move,validationReason:checked.reason});
  }
  const sorted=rows.slice(1).map(r=>r.latencyMs).sort((a,b)=>a-b);
  const summary={cases:rows.length,agreement:rows.filter(r=>r.move===r.reference).length,validatedAgreement:rows.filter(r=>r.validatedMove===r.reference).length,interventions:rows.filter(r=>r.validatedMove!==r.move).length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],firstMs:rows[0].latencyMs};
  const report={createdAt:new Date().toISOString(),runtime:'laya-mlx 0.3.0',model:'aac6fef/laya-typed-decisions-mlx',revision:'f9e501c2080cc57c13d6887820329758f5351125',scope:'Synthetic six-deck S17/DAS/no-surrender decision comparison. No wagers or account data. Agreement is not a win rate.',summary,rows};
  await fs.writeFile(path.join(directory,'validation.json'),JSON.stringify(summary,null,2),{mode:0o600});
  await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/local-ai-validation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(summary));
}finally{ai.dispose();}
