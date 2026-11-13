// Independent card draws (infinite-shoe approximation), S17. We do not infer
// hidden cards or an unobserved shoe composition from short winning/losing runs.
const draws=Array.from({length:10},(_,index)=>[index+1,index===9?4/13:1/13]);
const cardValue=rank=>rank==='A'?1:['10','J','Q','K'].includes(rank)?10:/^[2-9]$/.test(rank)?Number(rank):null;
const total=(base,aces)=>base+(aces>0&&base+10<=21?10:0);
const distributions=new Map();
export function dealerDistribution(upcard,peek=true) {
  const up=cardValue(upcard);if(!up)return null;
  const cacheKey=`${up}:${peek}`;if(distributions.has(cacheKey))return {...distributions.get(cacheKey)};
  const memo=new Map();
  function walk(base,aces) {
    const key=`${base}:${aces}`;if(memo.has(key))return memo.get(key);
    const value=total(base,aces),out={17:0,18:0,19:0,20:0,21:0,bust:0,blackjack:0};
    if(value>21)out.bust=1;
    else if(value>=17)out[value]=1;
    else for(const [rank,probability] of draws){const next=walk(base+rank,aces+(rank===1?1:0));for(const result of Object.keys(out))out[result]+=probability*next[result];}
    memo.set(key,out);return out;
  }
  const result={17:0,18:0,19:0,20:0,21:0,bust:0,blackjack:0};
  const naturalProbability=up===1?4/13:up===10?1/13:0;
  for(const [hole,probability] of draws) {
    const natural=up===1&&hole===10||up===10&&hole===1;
    if(natural){if(!peek)result.blackjack+=probability;continue;}
    const distribution=walk(up+hole,(up===1?1:0)+(hole===1?1:0));
    const weight=probability/(peek?1-naturalProbability:1);
    for(const key of Object.keys(result))result[key]+=weight*distribution[key];
  }
  distributions.set(cacheKey,result);return {...result};
}
export function blackjackExpectedValues(state) {
  const values=state?.cards?.map(cardValue);
  if(!values||values.length<2||values.some(v=>v===null)||!cardValue(state.dealer))return null;
  const base=values.reduce((a,b)=>a+b,0),aces=values.filter(v=>v===1).length;
  if(total(base,aces)>21)return null;
  function scenario(peek) {
    const distribution=dealerDistribution(state.dealer,peek),memo=new Map();
    function stand(sum,count,natural=false) {
      const value=total(sum,count);if(value>21)return -1;
      if(natural)return 1.5*(1-distribution.blackjack);
      let ev=distribution.bust-distribution.blackjack;
      for(let dealer=17;dealer<=21;dealer++)ev+=distribution[dealer]*(value>dealer?1:value===dealer?0:-1);
      return ev;
    }
    function hit(sum,count) {
      let ev=0;
      for(const [rank,probability] of draws) {
        const next=sum+rank,remaining=count+(rank===1?1:0),value=total(next,remaining);
        ev+=probability*(value>21?-1:best(next,remaining));
      }
      return ev;
    }
    function best(sum,count) {
      const key=`${sum}:${count}`;if(memo.has(key))return memo.get(key);
      const ev=Math.max(stand(sum,count),hit(sum,count));memo.set(key,ev);return ev;
    }
    const natural=values.length===2&&total(base,aces)===21&&!state.fromSplit;
    const out={stand:stand(base,aces,natural),hit:hit(base,aces)};
    if(state.canDouble&&values.length===2)out.double=2*draws.reduce((ev,[rank,probability])=>ev+probability*stand(base+rank,aces+(rank===1?1:0)),0);
    return out;
  }
  return {peek:scenario(true),noPeek:scenario(false)};
}
export function validateLocalProposal(state,reference,proposal) {
  const ev=blackjackExpectedValues(state);
  if(proposal===reference)return {move:reference,reason:'matches',ev};
  // Splitting/resplitting requires a separate composition-dependent joint-hand
  // calculation. Never substitute a non-split estimate for that calculation.
  if(reference==='split'||proposal==='split')return {move:reference,reason:'split-reference',ev};
  if(!ev||!Number.isFinite(ev.peek[proposal])||!Number.isFinite(ev.peek[reference]))return {move:reference,reason:'unknown',ev};
  const better=ev.peek[proposal]>ev.peek[reference]+.03&&ev.noPeek[proposal]>ev.noPeek[reference]+.03;
  return {move:better?proposal:reference,reason:better?'better-ev':'weaker-ev',ev};
}
