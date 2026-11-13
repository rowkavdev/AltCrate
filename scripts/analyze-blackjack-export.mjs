import fs from 'node:fs';
import crypto from 'node:crypto';

const [sourcePath,referencePath,outputPath]=process.argv.slice(2);
if(!sourcePath||!referencePath||!outputPath)throw new Error('Requires source export, independent strategy CSV and output path');
const source=fs.readFileSync(sourcePath),reference=fs.readFileSync(referencePath,'utf8');
const data=JSON.parse(source);
if(!Array.isArray(data.blackjack)||!Array.isArray(data.events))throw new Error('Unexpected export shape');
const matrix=new Map(reference.trim().split(/\r?\n/).map(line=>{const [key,...moves]=line.split(',');if(moves.length!==10)throw new Error('Unexpected reference shape');return [key,moves];}));
const rank=c=>c?.rank==='A'?11:['10','J','Q','K'].includes(c?.rank)?10:/^[2-9]$/.test(c?.rank)?Number(c.rank):null;
function handValue(cards) {
  const values=cards.map(rank);if(values.some(n=>n===null))return null;
  let total=values.reduce((a,b)=>a+b,0),aces=values.filter(n=>n===11).length;
  while(total>21&&aces){total-=10;aces--;}
  return {total,soft:aces>0,values};
}
function independentMove(a) {
  if(a.action!=='play'||!a.dealerCard?.[0])return null;
  const hand=handValue(a.cards||[]),up=rank(a.dealerCard[0]);if(!hand||!up||hand.values.length<2)return null;
  const funded=Number.isFinite(a.tokens)&&Number.isFinite(a.bet)&&a.bet>0&&a.tokens>=a.bet;
  const double=hand.values.length===2&&!a.splitAces&&funded;
  const split=double&&a.handCount<4&&hand.values[0]===hand.values[1];
  let cell;
  if(split)cell=matrix.get(`s${hand.values[0]}`)?.[up-2];
  if(cell==='p')return 'split';
  cell=matrix.get(`${hand.soft?'a':'n'}${hand.total}`)?.[up-2];
  if(!cell)return null;
  if(cell[0]==='d')return double?'double':cell[1]==='s'?'stand':'hit';
  if(cell[0]==='u')return 'hit'; // no surrender in the site's public rules
  return cell==='s'?'stand':cell==='h'?'hit':null;
}
const accountAliases=new Map(),tableAliases=new Map(),previous=new Map(),seen=new Set(),duplicates=[];
const alias=(map,id,prefix)=>{if(!map.has(id))map.set(id,`${prefix}${map.size+1}`);return map.get(id);};
const rows=data.blackjack.slice().sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt))).map(row=>{
  const account=alias(accountAliases,row.accountId,'account'),table=alias(tableAliases,row.tableId,'table');
  const key=`${account}:${table}:${row.roundNumber}`;if(seen.has(key))duplicates.push(key);seen.add(key);
  const actions=(row.actions||[]).filter(a=>a.action==='play').map(a=>({move:a.move,reference:independentMove(a),matchesReference:a.move===independentMove(a),cards:(a.cards||[]).map(c=>`${c.rank}${c.suit}`),dealer:(a.dealerCard||[]).map(c=>`${c.rank}${c.suit}`),engine:a.decisionEngine,mathRecorded:a.math!=null,deadlineMarginMs:a.deadlineMarginMs,transitionMs:a.transitionMs}));
  const bet=(row.actions||[]).find(a=>a.action==='bet');
  const group=`${account}:${table}`,prior=previous.get(group);
  const expectedBase=prior?Math.max(1,Math.min(5000000,prior.profit>0?prior.base*2:prior.profit<0?Math.floor(prior.base/2):prior.base)):bet?.bet;
  const staked=(row.hands||[]).reduce((n,h)=>n+(h.bet||0),0),returned=(row.hands||[]).reduce((n,h)=>n+(h.payout||0),0);
  const balanceGap=prior&&Number.isFinite(bet?.tokens)?bet.tokens-(prior.balance+prior.profit):null;
  if(Number.isFinite(row.netProfit)&&bet)previous.set(group,{base:bet.bet,profit:row.netProfit,balance:bet.tokens});
  return {account,table,round:row.roundNumber,shuffleCount:row.shuffleCount,baseBet:bet?.bet,expectedBase,progressionMatches:bet&&bet.progression!=='edge'?bet.bet===expectedBase:null,bettingPolicy:bet?.progression||null,stakeWithinCeiling:bet?.betting?bet.bet<=bet.betting.ceiling:null,edgeReserveMatches:bet?.betting?.reason==='edge'?bet.bet*8<=bet.tokens:null,profit:row.netProfit,staked,returned,payoutMatchesProfit:Math.abs(returned-staked-row.netProfit)<1e-7,balanceGap,missingTurns:row.turnsWithoutCommand,handValuesConsistent:(row.hands||[]).every(h=>handValue(h.cards)?.total===h.value),dealerValueConsistent:handValue(row.dealerCards||[])?.total===row.dealerValue,actions};
});
let currentRun=null;const openings=[];
for(const event of data.events) {
  if(event.type==='open-started'){currentRun={number:openings.length+1,startedAt:event.at,opened:0,converted:0,tokens:0,money:0};openings.push(currentRun);}
  if(!currentRun)continue;
  if(event.type==='open')currentRun.opened+=event.openedCount||0;
  if(event.type==='conversion'){currentRun.converted++;currentRun.tokens+=event.tokenDelta||0;currentRun.money+=event.moneyDelta||0;}
  if(event.type==='open-finished')currentRun.finishedAt=event.at;
}
const settled=rows.filter(r=>Number.isFinite(r.profit)),moves=rows.flatMap(r=>r.actions);
const report={
  sourceExportedAt:data.exportedAt,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
  independentReference:{url:'https://raw.githubusercontent.com/AttackingOrDefending/Blackjack-Strategy-Simulator/main/data/6deck_s17_das_peek_basic_strategy.csv',sha256:crypto.createHash('sha256').update(reference).digest('hex'),assumptions:'Six decks, S17, double after split, dealer peek, no surrender. Backend peek policy is not confirmed.'},
  summary:{rounds:settled.length,wins:settled.filter(r=>r.profit>0).length,losses:settled.filter(r=>r.profit<0).length,pushes:settled.filter(r=>r.profit===0).length,won:settled.reduce((n,r)=>n+Math.max(0,r.profit),0),lost:settled.reduce((n,r)=>n+Math.max(0,-r.profit),0),net:settled.reduce((n,r)=>n+r.profit,0),staked:settled.reduce((n,r)=>n+r.staked,0),returned:settled.reduce((n,r)=>n+r.returned,0),playActions:moves.length,referenceMatches:moves.filter(a=>a.matchesReference).length,engines:Object.fromEntries([...new Set(moves.map(a=>a.engine))].map(engine=>[engine,moves.filter(a=>a.engine===engine).length])),mathematicalActions:moves.filter(a=>a.mathRecorded).length,shuffleCounts:[...new Set(rows.map(r=>r.shuffleCount))],duplicates,progressionErrors:rows.filter(r=>r.progressionMatches===false).map(r=>r.round),balanceGaps:rows.filter(r=>r.balanceGap!=null&&Math.abs(r.balanceGap)>1e-6).map(r=>r.round),payoutErrors:rows.filter(r=>!r.payoutMatchesProfit).map(r=>r.round),stakePlanErrors:rows.filter(r=>r.stakeWithinCeiling===false||r.edgeReserveMatches===false).map(r=>({table:r.table,round:r.round})),missingTurns:rows.reduce((n,r)=>n+(r.missingTurns||0),0)},
  rows,openings,
  limits:['This file does not record enough data to establish why the game stopped or disconnected.','Constant shuffleCount and table-only decisions do not demonstrate the finite-shoe solver running.','No natural blackjack in this sample: the 3:2 rounding question cannot be tested here.','A short losing sample does not establish biased dealing, future profitability or a superior strategy.']
};
fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,openings:report.openings},null,2));
