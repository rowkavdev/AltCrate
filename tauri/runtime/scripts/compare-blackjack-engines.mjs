// Offline paired experiment. The policy gets visible ranks/counts only, never
// the shuffled future order or dealer hole. Environments copy the same shoe.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {blackjackAdvice} from '../strategy/blackjackAuto.js';
import {finiteShoeExpectedValues,chooseFiniteMove} from '../strategy/blackjackFinite.js';
const rank=n=>n===1?'A':n===10?'10':String(n);
const value=cards=>{let v=cards.reduce((a,b)=>a+b,0);if(cards.includes(1)&&v+10<=21)v+=10;return v;};
const natural=h=>!h.fromSplit&&h.cards.length===2&&value(h.cards)===21;
const ref=(h,up,double,split)=>({'Pedir carta':'hit',Parar:'stand',Dobrar:'double',Dividir:'split'})[blackjackAdvice({cards:h.cards.map(n=>({rank:rank(n)}))},{rank:rank(up)},double,split)];
export function simulateRound(order,{mode='table',peek=true,payout=1.5,maxNodes=450000,maxMs=300}={}) {
 let cursor=0,available=8,stake=1;
 const deal=()=>{if(cursor>=order.length)throw new Error('Simulation exhausted');return order[cursor++];};
 const hands=[{cards:[deal(),deal()],bet:1,fromSplit:false,splitAces:false,status:'playing'}],up=deal(),hole=deal();
 const counts=Array(10).fill(0);for(const card of order)counts[card-1]++;
 for(const card of [...hands[0].cards,up])counts[card-1]--;
 const draw=()=>{const n=deal();counts[n-1]--;return n;};
 const dealerNatural=value([up,hole])===21;
 const diagnostics={computed:0,fallback:0,changed:0,latencies:[],reasons:{},changes:[]};
 if(peek&&dealerNatural)return {net:natural(hands[0])?0:-1,stake,diagnostics};
 for(let index=0;index<hands.length;index++) {
  const hand=hands[index];if(hand.status!=='playing'||natural(hand)) {hand.status='stand';continue;}
  for(let turns=0;turns<20&&hand.status==='playing';turns++) {
   if(value(hand.cards)>=21){hand.status='stand';break;}
   const canDouble=hand.cards.length===2&&!hand.splitAces&&available>=hand.bet;
   const canSplit=canDouble&&hands.length<4&&hand.cards[0]===hand.cards[1];
   let move=ref(hand,up,canDouble,canSplit);
   if(mode==='math') {
    const result=finiteShoeExpectedValues({cards:hand.cards.map(rank),dealer:rank(up),counts,canDouble,canSplit,availableUnits:available,activeHandIndex:index,hands:hands.map(h=>({...h,cards:h.cards.map(rank),betUnits:h.bet}))},{maxNodes,maxMs});
    const chosen=chooseFiniteMove(result,move);diagnostics.latencies.push(result.latencyMs||0);
    diagnostics[result.complete?'computed':'fallback']++;if(!result.complete)diagnostics.reasons[result.reason]=(diagnostics.reasons[result.reason]||0)+1;
    if(chosen!==move){diagnostics.changed++;diagnostics.changes.push({cards:hand.cards.map(rank),dealer:rank(up),reference:move,chosen,peek:result.peek,noPeek:result.noPeek,remaining:counts.reduce((a,b)=>a+b,0)});}move=chosen;
   }
   if(move==='stand')hand.status='stand';
   else if(move==='hit'){hand.cards.push(draw());if(value(hand.cards)>=21)hand.status='stand';}
   else if(move==='double'){available-=hand.bet;stake+=hand.bet;hand.bet*=2;hand.cards.push(draw());hand.status='stand';}
   else if(move==='split') {
    available-=hand.bet;stake+=hand.bet;
    const r=hand.cards[0],children=[0,1].map(()=>({cards:[r,draw()],bet:hand.bet,fromSplit:true,splitAces:r===1,status:r===1?'stand':'playing'}));
    hands.splice(index,1,...children);index--;break;
   } else throw new Error('Invalid policy action');
  }
 }
 const dealer=[up,hole];if(!dealerNatural&&hands.some(h=>value(h.cards)<=21&&!natural(h)))while(value(dealer)<17)dealer.push(deal());
 const d=value(dealer);
 const net=hands.reduce((sum,h)=>sum+(value(h.cards)>21?-h.bet:dealerNatural?(natural(h)?0:-h.bet):natural(h)?payout*h.bet:d>21||value(h.cards)>d?h.bet:value(h.cards)===d?0:-h.bet),0);
 return {net,stake,diagnostics};
}
const rng=seed=>()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
function shoe(random){const cards=[];for(let n=1;n<=10;n++)for(let i=0;i<(n===10?96:24);i++)cards.push(n);for(let i=cards.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}return cards.slice(Math.floor(random()*157));}
const mean=ns=>ns.reduce((a,b)=>a+b,0)/ns.length;
const summary=rows=>({rounds:rows.length,net:rows.reduce((a,b)=>a+b.net,0),stake:rows.reduce((a,b)=>a+b.stake,0),meanNetPerInitialUnit:mean(rows.map(r=>r.net)),positive:rows.filter(r=>r.net>0).length,negative:rows.filter(r=>r.net<0).length,push:rows.filter(r=>r.net===0).length});
export function pairedSummary(base,math){const diffs=math.map((r,i)=>r.net-base[i].net),m=mean(diffs),variance=diffs.length>1?diffs.reduce((a,d)=>a+(d-m)**2,0)/(diffs.length-1):0,margin=1.96*Math.sqrt(variance/diffs.length);return {table:summary(base),math:summary(math),pairedDifferencePerInitialUnit:m,approximate95PercentCI:[m-margin,m+margin]};}
async function main(){
 const rounds=Number(process.argv[2]||500),out=process.argv[3]||'artifacts/blackjack-paired-v0.2.14.json';
 if(!Number.isSafeInteger(rounds)||rounds<2||rounds>100000)throw new Error('Invalid round count');
 const seed=Number(process.argv[4]||2026100814);
 const random=rng(seed),changes=[],groups={peek:{base:[],math:[]},noPeek:{base:[],math:[]}};let computed=0,fallback=0,changed=0;const latencies=[],reasons={};
 for(let i=0;i<rounds;i++) {
  const order=shoe(random);
  for(const [key,g] of Object.entries(groups)) {
   const options={peek:key==='peek'};const base=simulateRound(order,options),math=simulateRound(order,{...options,mode:'math'});
   g.base.push(base);g.math.push(math);const d=math.diagnostics;if(d.changes.length)changes.push({pair:i+1,scenario:key,tableNet:base.net,mathNet:math.net,decisions:d.changes});computed+=d.computed;fallback+=d.fallback;changed+=d.changed;latencies.push(...d.latencies);for(const [r,n] of Object.entries(d.reasons))reasons[r]=(reasons[r]||0)+n;
  }
  if((i+1)%50===0)process.stdout.write(`${i+1}/${rounds} paired shoes completed\n`);
 }
 latencies.sort((a,b)=>a-b);
 const report={version:'0.2.14',seed,generatedAt:new Date().toISOString(),kind:'offline-paired-simulation',rules:{decks:6,soft17:'stand',payout:1.5,maxHands:4,doubleAfterSplit:true,splitAcesOneCard:true,extraFunds:8,baseStake:1},method:'Each pair copies the same randomly shuffled six-deck shoe, with 0–156 prior visible cards removed. The engine sees counts and exposed cards only. Unknown peek is evaluated both ways by the policy. Stakes are fixed to isolate decisions; a time/node budget invokes the verified basic table. Payout is fractional 3:2, not a verified Case Clicker rounding rule.',limitations:['Simulation does not validate server RNG, peek or payment rounding.','Normal paired confidence interval is approximate and not proof of positive real-world return.','Random depletion is an experimental design, not confirmation of the public reshufflePenetration field.','Low frequency of changed choices needs a larger sample to estimate small advantages.'],changedRounds:changes,scenarios:Object.fromEntries(Object.entries(groups).map(([key,g])=>[key,pairedSummary(g.base,g.math)])),decisions:{computed,fallback,changed,reasons,p50Ms:latencies[Math.floor(latencies.length*.5)]||0,p95Ms:latencies[Math.floor(latencies.length*.95)]||0}};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify(report.scenarios)+'\n'+JSON.stringify(report.decisions)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
