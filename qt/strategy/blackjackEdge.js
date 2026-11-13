import {blackjackAdvice} from './blackjackAuto.js';
const code=['','A','2','3','4','5','6','7','8','9','10'];
const caches=new Map();
const value=cards=>{const base=cards.reduce((a,b)=>a+b,0);return base+(cards.includes(1)&&base+10<=21?10:0);};
const natural=h=>!h.fromSplit&&h.cards.length===2&&value(h.cards)===21;
const rng=seed=>()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
const hash=counts=>counts.reduce((h,n)=>Math.imul(h^n,16777619)>>>0,2166136261);

// This samples a declared finite-shoe model, not the site's hidden order/RNG.
// Confidence bounds cover sampling uncertainty only. The basic policy uses
// funded doubles/resplits with at most 4 hands and a total 8-unit bankroll.
export function estimatePreBetEdge(state,{samples=60000,maxMs=750,seed=hash(state?.counts||[]),delta=.01}={}) {
 const initial=state?.counts,unit=state?.stakeUnit;
 const rules={dealerStandsOnSoft17:true,doubleAfterSplit:true,maxHandsPerSeat:4,splitAcesOneCard:true,...state?.rules};
 if(!Array.isArray(initial)||initial.length!==10||initial.some(n=>!Number.isSafeInteger(n)||n<0)||initial.reduce((a,b)=>a+b,0)<24||!(Number.isSafeInteger(unit)&&unit>0)||!Number.isInteger(samples)||samples<128||samples>500000||!(delta>0&&delta<1)||!rules.dealerStandsOnSoft17||!rules.doubleAfterSplit||rules.maxHandsPerSeat!==4||!rules.splitAcesOneCard)return {complete:false,reason:'invalid'};
 const key=JSON.stringify([initial,unit,rules,samples,seed,delta]);if(caches.has(key))return {...caches.get(key),cached:true,latencyMs:0};
 const started=performance.now(),payout=(Math.floor(2.5*unit)-unit)/unit;
 function world(random,peek) {
  const counts=initial.slice();let remaining=counts.reduce((a,b)=>a+b,0),funds=7;
  function draw(){if(!remaining)throw new Error('exhausted');let target=random()*remaining;for(let r=0;r<10;r++){target-=counts[r];if(target<0){counts[r]--;remaining--;return r+1;}}throw new Error('invalid');}
  const hands=[{cards:[draw(),draw()],bet:1,fromSplit:false,splitAces:false}],dealer=[draw(),draw()],up={rank:code[dealer[0]]};
  const dealerNatural=value(dealer)===21;
  if(peek&&dealerNatural)return natural(hands[0])?0:-1;
  for(let index=0;index<hands.length;index++) {
   const h=hands[index];if(natural(h)||h.splitAces)continue;
   for(let turns=0;turns<30&&value(h.cards)<21;turns++) {
    const double=h.cards.length===2&&funds>=h.bet;
    const split=double&&hands.length<4&&h.cards[0]===h.cards[1];
    const action=blackjackAdvice({cards:h.cards.map(r=>({rank:code[r]}))},up,double,split);
    if(action==='Parar')break;
    if(action==='Pedir carta')h.cards.push(draw());
    else if(action==='Dobrar'){funds-=h.bet;h.bet*=2;h.cards.push(draw());break;}
    else if(action==='Dividir'){
     funds-=h.bet;const r=h.cards[0];hands.splice(index,1,...[0,1].map(()=>({cards:[r,draw()],bet:h.bet,fromSplit:true,splitAces:r===1})));index--;break;
    } else throw new Error('invalid');
   }
  }
  if(!dealerNatural&&hands.some(h=>value(h.cards)<=21&&!natural(h)))while(value(dealer)<17)dealer.push(draw());
  const d=value(dealer);
  return hands.reduce((n,h)=>n+(value(h.cards)>21?-h.bet:dealerNatural?(natural(h)?0:-h.bet):natural(h)?payout*h.bet:d>21||value(h.cards)>d?h.bet:value(h.cards)===d?0:-h.bet),0);
 }
 function sample(peek,offset) {
  const random=rng((seed+offset)>>>0);let mean=0,m2=0,sumSquares=0;
  for(let i=0;i<samples;i++) {
   if(i%128===0&&performance.now()-started>maxMs)throw new Error('budget');
   const x=world(random,peek);if(x< -8||x>8)throw new Error('invalid');
   const diff=x-mean;mean+=diff/(i+1);m2+=diff*(x-mean);sumSquares+=x*x;
  }
  const variance=m2/(samples-1),log=Math.log(8/delta);
  // Maurer/Pontil theorem 4 (arXiv:0907.3740), bounded range 16.
  // Union bound over both tails of both peek models; fixed sample size.
  const radius=Math.sqrt(2*variance*log/samples)+7*16*log/(3*(samples-1));
  return {mean,variance,secondMoment:sumSquares/samples,lower:mean-radius,upper:mean+radius};
 }
 try {
  const peek=sample(true,0),noPeek=sample(false,7919);
  const result={complete:true,samples,peek,noPeek,lowerBound:Math.min(peek.lower,noPeek.lower),secondMoment:Math.max(peek.secondMoment,noPeek.secondMoment),latencyMs:Math.round(performance.now()-started),assumptions:{policy:'basic-strategy',payout:'floor-3:2',stakeUnit:unit,confidence:1-delta,maxTotalStake:8,source:'declared-rules'}};
  caches.set(key,result);if(caches.size>32)caches.delete(caches.keys().next().value);return result;
 } catch(error){return {complete:false,reason:error.message,latencyMs:Math.round(performance.now()-started)};}
}

export function planAdvantageStake({tokens,minBet=1,maxBet=5000000,ceiling},edge) {
 const min=Math.max(1,Math.ceil(minBet)),max=Math.min(5000000,Math.floor(maxBet),Math.floor(ceiling),Math.floor(tokens));
 if(!Number.isFinite(tokens)||!Number.isSafeInteger(ceiling)||max<min)return {amount:null,reason:'funds'};
 const reserveFactor=8,limit=Math.min(max,Math.floor(tokens/reserveFactor));
 let base=min;
 // Even stakes avoid fractional 3:2 payments when floor rounding is possible.
 if(min%2&&min+1<=limit)base=min+1;
 const reserveCovered=base<=limit;
 let amount=base,reason='minimum';
 if(reserveCovered&&edge?.complete&&edge.lowerBound>0&&Number.isFinite(edge.secondMoment)&&edge.secondMoment>0&&edge.assumptions?.stakeUnit!==undefined&&edge.assumptions.stakeUnit!==base)return {amount:base,reason:'minimum',unit:base,reserveFactor,reserveCovered};
 if(reserveCovered&&edge?.complete&&Number.isFinite(edge.lowerBound)&&edge.lowerBound>0&&Number.isFinite(edge.secondMoment)&&edge.secondMoment>0) {
  let suggested=Math.min(limit,Math.floor(tokens*edge.lowerBound/edge.secondMoment/4));
  if(suggested%2&&suggested-1>=min)suggested--;
  if(suggested>base){amount=suggested;reason='edge';}
 }
 return {amount,reason,unit:base,reserveFactor,reserveCovered};
}
