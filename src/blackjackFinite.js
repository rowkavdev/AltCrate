const rankValue=rank=>rank==='A'?1:['10','J','Q','K'].includes(rank)?10:/^[2-9]$/.test(rank)?Number(rank):null;
const total=h=>h.sum+(h.aces>0&&h.sum+10<=21?10:0);
const outcomes=()=>[0,0,0,0,0,0,0]; // 17..21, bust, natural
const add=(h,r)=>({...h,sum:h.sum+r,aces:h.aces+(r===1?1:0),length:h.length+1,pair:h.length===1&&h.sum===r?r:0});
const completed=new Map();

// Exact removal with one marginalized hidden hole card. Every own hand shares
// the remaining shoe and dealer; split capacity and extra funds are shared too.
// Unknown peek policy is evaluated both ways; no-peek assumes all stakes lost
// to a dealer natural. Incomplete computations never return action values.
export function finiteShoeExpectedValues(state,{maxNodes=450000,maxMs=300}={}) {
  const up=rankValue(state?.dealer),initial=state?.counts;
  const rules={maxHandsPerSeat:4,doubleAfterSplit:true,splitAcesOneCard:true,dealerStandsOnSoft17:true,blackjackPayout:1.5,...state?.rules};
  if(!up||!Array.isArray(initial)||initial.length!==10||initial.some(n=>!Number.isSafeInteger(n)||n<0)||initial.reduce((a,b)=>a+b,0)<2||!Number.isInteger(rules.maxHandsPerSeat)||rules.maxHandsPerSeat<1||rules.maxHandsPerSeat>4||![1,1.5].includes(rules.blackjackPayout))return {complete:false,reason:'invalid'};
  const rawHands=state.hands||[{cards:state.cards,fromSplit:state.fromSplit,splitAces:state.splitAces,status:'playing',betUnits:1}];
  const active=state.activeHandIndex??0;
  const hands=rawHands.map(h=>{
    const ranks=h.cards?.map(rankValue);if(!ranks?.length||ranks.some(r=>!r)||!(h.betUnits>0||h.betUnits===undefined))return null;
    return {sum:ranks.reduce((a,b)=>a+b,0),aces:ranks.filter(r=>r===1).length,length:ranks.length,pair:ranks.length===2&&ranks[0]===ranks[1]?ranks[0]:0,bet:h.betUnits??1,fromSplit:h.fromSplit===true,splitAces:h.splitAces===true,done:h.status!==undefined&&h.status!=='playing'};
  });
  if(!hands.length||hands.length>rules.maxHandsPerSeat||hands.some(h=>!h)||!hands[active]||hands[active].done||hands[active].length<2||total(hands[active])>21)return {complete:false,reason:'invalid'};
  const funds=Math.min(8* Math.max(...hands.map(h=>h.bet)),state.availableUnits??(state.canDouble||state.canSplit?8:0));
  if(!Number.isFinite(funds)||funds<0)return {complete:false,reason:'invalid'};
  const cacheKey=JSON.stringify([up,initial,hands,active,funds,!!state.canDouble,!!state.canSplit,rules]);
  if(completed.has(cacheKey))return {...completed.get(cacheKey),cached:true,latencyMs:0};
  const started=performance.now();let nodes=0;
  const tick=()=>{if(++nodes>maxNodes||nodes%128===0&&performance.now()-started>maxMs)throw new Error('budget');};
  function scenario(peek) {
    const counts=initial.slice(),dealerCache=new Map(),walkCache=new Map(),bestCache=new Map();
    const forbidden=peek?(up===1?9:up===10?0:-1):-1;
    const allowed=()=>counts.reduce((a,b,index)=>a+(index===forbidden?0:b),0);
    function walk(sum,aceCount) {
      tick();const key=`${sum}:${aceCount}:${counts.join(',')}`;
      if(walkCache.has(key))return walkCache.get(key);
      const out=outcomes(),value=total({sum,aces:aceCount});
      if(value>21)out[5]=1;
      else if(value>=17&&!(value===17&&aceCount>0&&sum+10===17&&!rules.dealerStandsOnSoft17))out[value-17]=1;
      else {
        const n=counts.reduce((a,b)=>a+b,0);if(!n)throw new Error('exhausted');
        for(let index=0;index<10;index++)if(counts[index]) {
          const p=counts[index]/n;counts[index]--;
          const next=walk(sum+index+1,aceCount+(index===0?1:0));counts[index]++;
          for(let j=0;j<7;j++)out[j]+=p*next[j];
        }
      }
      walkCache.set(key,out);return out;
    }
    function dealer() {
      tick();const key=counts.join(',');if(dealerCache.has(key))return dealerCache.get(key);
      const out=outcomes(),a=allowed();if(!a)throw new Error('exhausted');
      for(let index=0;index<10;index++)if(index!==forbidden&&counts[index]) {
        const p=counts[index]/a;
        if(up===1&&index===9||up===10&&index===0){out[6]+=p;continue;}
        counts[index]--;const next=walk(up+index+1,(up===1?1:0)+(index===0?1:0));counts[index]++;
        for(let j=0;j<7;j++)out[j]+=p*next[j];
      }
      dealerCache.set(key,out);return out;
    }
    function settle(hs) {
      if(hs.every(h=>total(h)>21))return -hs.reduce((n,h)=>n+h.bet,0);
      const d=dealer();let result=0;
      for(const h of hs) {
        const value=total(h);if(value>21){result-=h.bet;continue;}
        if(value===21&&h.length===2&&!h.fromSplit){result+=h.bet*rules.blackjackPayout*(1-d[6]);continue;}
        let ev=d[5]-d[6];for(let j=0;j<5;j++)ev+=d[j]*(value>j+17?1:value===j+17?0:-1);
        result+=h.bet*ev;
      }
      return result;
    }
    function draw(continuation) {
      const n=counts.reduce((a,b)=>a+b,0),a=allowed();if(n<2||!a)throw new Error('exhausted');
      let ev=0;
      for(let index=0;index<10;index++)if(counts[index]) {
        const p=counts[index]*(a-(index===forbidden?0:1))/(a*(n-1));
        if(p<=0)continue;
        counts[index]--;ev+=p*continuation(index+1);counts[index]++;
      }
      return ev;
    }
    const replace=(hs,i,h)=>hs.map((old,j)=>i===j?h:old);
    function advance(hs,i,money) {
      const next=hs.findIndex((h,index)=>index>=i&&!h.done);
      return next<0?settle(hs):best(hs,next,money);
    }
    function options(hs,i,money,root=false) {
      tick();const h=hs[i];
      const stand=()=>advance(replace(hs,i,{...h,done:true}),i+1,money);
      const result={stand:stand()};
      if(total(h)===21)return result;
      result.hit=draw(rank=>{const next=add(h,rank);return total(next)>=21?advance(replace(hs,i,{...next,done:true}),i+1,money):best(replace(hs,i,next),i,money);});
      const doubleAllowed=h.length===2&&!h.splitAces&&(!h.fromSplit||rules.doubleAfterSplit)&&money>=h.bet&&(!root||state.canDouble);
      if(doubleAllowed)result.double=draw(rank=>advance(replace(hs,i,{...add(h,rank),bet:2*h.bet,done:true}),i+1,money-h.bet));
      const splitAllowed=h.pair&&h.length===2&&hs.length<rules.maxHandsPerSeat&&money>=h.bet&&!(h.splitAces&&rules.splitAcesOneCard)&&(!root||state.canSplit);
      if(splitAllowed)result.split=draw(first=>draw(second=>{
        const child={sum:h.pair,aces:h.pair===1?1:0,length:1,pair:0,bet:h.bet,fromSplit:true,splitAces:h.pair===1,done:false};
        const children=[add(child,first),add(child,second)].map(c=>({...c,done:total(c)===21||c.splitAces&&rules.splitAcesOneCard}));
        const next=[...hs.slice(0,i),...children,...hs.slice(i+1)];
        return advance(next,i,money-h.bet);
      }));
      return result;
    }
    function best(hs,i,money) {
      tick();const key=JSON.stringify([hs,i,money,counts]);
      if(bestCache.has(key))return bestCache.get(key);
      const result=Math.max(...Object.values(options(hs,i,money)));bestCache.set(key,result);return result;
    }
    return options(hands,active,funds,true);
  }
  try {
    const peek=scenario(true),noPeek=up===1||up===10?scenario(false):{...peek};
    const result={complete:true,scope:'whole-seat',peek,noPeek,nodes,latencyMs:Math.round(performance.now()-started)};
    completed.set(cacheKey,result);if(completed.size>128)completed.delete(completed.keys().next().value);return result;
  } catch(error){return {complete:false,reason:error.message,nodes,latencyMs:Math.round(performance.now()-started)};}
}
export function chooseFiniteMove(result,reference) {
  if(!result?.complete||!Number.isFinite(result.peek?.[reference])||!Number.isFinite(result.noPeek?.[reference]))return reference;
  return Object.keys(result.peek).reduce((chosen,move)=>result.peek[move]>result.peek[chosen]+1e-6&&result.noPeek[move]>result.noPeek[chosen]+1e-6?move:chosen,reference);
}
