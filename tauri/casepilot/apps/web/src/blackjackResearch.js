const value = rank => rank==='A'?1:['10','J','Q','K'].includes(rank)?10:/^[2-9]$/.test(rank)?Number(rank):null;
const suit = s => ({HEARTS:'H',DIAMONDS:'D',CLUBS:'C',SPADES:'S'})[s]||s;
const hiLo = rank => value(rank)>=2&&value(rank)<=6?1:value(rank)===1||value(rank)===10?-1:0;
const fresh = () => [24,24,24,24,24,24,24,24,24,96];

// Counts only revealed cards. A hidden hole card is still represented among
// the unknown cards; the finite solver marginalizes it rather than guessing it.
export function createShoeTracker({now=Date.now}={}) {
  let creationUntil=0,origin=null;
  let tableId=null,shuffle=null,round=null,usable=false,reason='A aguardar uma renovação observada',counts=fresh(),running=0,groups=new Map(),holeHidden=true;
  const invalidate = message => {usable=false;reason=message;creationUntil=0;};
  function reset() {counts=fresh();running=0;groups=new Map();round=null;holeHidden=false;}
  function snapshot() {
    const remaining=counts.reduce((a,b)=>a+b,0),observed=312-remaining;
    return {tableId,shuffleCount:shuffle,usable,reason,origin,counts:counts.slice(),observed,remaining,runningCount:running,trueCount:usable&&remaining>0?running/(remaining/52):null};
  }
  function observe(table) {
    if(!table?.tableId || !Number.isSafeInteger(table.roundNumber)){invalidate('Estado da mesa incompleto');return snapshot();}
    const nextShuffle=Number.isSafeInteger(table.shuffleCount)&&table.shuffleCount>=0?table.shuffleCount:null;
    if(tableId!==table.tableId) {
      const created=creationUntil>now()&&table.phase==='betting'&&table.roundNumber===0&&nextShuffle===1&&Array.isArray(table.dealerCards)&&table.dealerCards.length===0&&Array.isArray(table.seats)&&table.seats.every(seat=>!seat||Array.isArray(seat.hands)&&seat.hands.length===0);
      tableId=table.tableId;shuffle=nextShuffle;reset();creationUntil=0;origin=created?'new-private-table':null;
      usable=created;reason=created?'Início vazio da mesa privada observado; 6 baralhos anunciados pelo cliente':'Início do baralho não observado';
    }
    else if(nextShuffle!==null&&shuffle!==null&&nextShuffle>shuffle) {
      reset();
      // A betting window is the public boundary before new cards are dealt.
      usable=table.phase==='betting';origin=usable?'observed-renewal':null;reason=usable?'Renovação observada; cartas visíveis contabilizadas':'Renovação recebida a meio da distribuição';
      shuffle=nextShuffle;
    } else if(nextShuffle===null||shuffle===null||nextShuffle<shuffle) {invalidate('Contador de renovação indisponível ou incoerente');shuffle=nextShuffle;}
    if(table.phase==='betting')return snapshot(); // old result cards can linger here
    if(table.visibleCardsComplete===false)invalidate('Lista de cartas incompleta ou desconhecida');
    if(round!==table.roundNumber) {
      if(round!==null&&(table.roundNumber!==round+1||holeHidden))invalidate('Faltam cartas ou rondas na observação');
      round=table.roundNumber;groups=new Map();
    }
    holeHidden=table.dealerHoleCardHidden!==false;
    const visible=[['dealer',table.dealerCards||[]],...(table.seats||[]).map((seat,index)=>[`seat:${index}`,seat?.hands?.flatMap(h=>h.cards||[])||[]])];
    for(const [group,cards] of visible) {
      const current=new Map(),previous=groups.get(group)||new Map();
      for(const card of cards) {
        const rank=value(card?.rank),s=suit(card?.suit);
        if(!rank||!['S','H','D','C'].includes(s)){invalidate('Carta desconhecida');continue;}
        const key=`${card.rank}:${s}`;current.set(key,(current.get(key)||0)+1);
      }
      // Combined seat hands avoid counting a split's transferred card twice.
      for(const [key,count] of current) {
        const delta=Math.max(0,count-(previous.get(key)||0));
        const rank=key.split(':')[0];counts[value(rank)-1]-=delta;running+=delta*hiLo(rank);
        previous.set(key,Math.max(count,previous.get(key)||0));
      }
      groups.set(group,previous);
    }
    if(counts.some(n=>n<0))invalidate('Composição impossível; falta uma renovação');
    return snapshot();
  }
  return {observe,snapshot,invalidate,beginCreation(){creationUntil=now()+15000;},cancelCreation(){creationUntil=0;}};
}

export function analyzeBlackjackPayouts(rows) {
  const seen=new Set(),out={naturals:0,exact:0,short:0,shortfall:0,floorCompatible:0,examples:[]};
  for(const row of rows||[]) {
    const key=`${row.accountId}:${row.tableId}:${row.roundNumber}`;
    if(seen.has(key)||!Number.isFinite(row.netProfit))continue;seen.add(key);
    for(const [index,hand] of (row.hands||[]).entries()) {
      if(hand.fromSplit||hand.result!=='blackjack'||hand.cards?.length!==2||!hand.cards.some(c=>c.rank==='A')||!hand.cards.some(c=>value(c.rank)===10)||!(hand.bet>0)||!Number.isFinite(hand.payout))continue;
      const expected=2.5*hand.bet,difference=expected-hand.payout;
      out.naturals++;if(Math.abs(difference)<1e-8)out.exact++;
      if(difference>1e-8){out.short++;out.shortfall+=difference;}
      if(Math.abs(Math.floor(expected)-hand.payout)<1e-8)out.floorCompatible++;
      out.examples.push({accountId:row.accountId,roundNumber:row.roundNumber,handIndex:index,bet:hand.bet,payout:hand.payout,expected,difference});
    }
  }
  return out;
}

export function summarizeEngineCoverage(rows) {
 const seen=new Set(),out={plays:0,computed:0,reference:0,fallback:0,reasons:{}};
 for(const row of rows||[]){const key=`${row.accountId}:${row.tableId}:${row.roundNumber}`;if(seen.has(key))continue;seen.add(key);
  for(const action of row.actions||[]){if(action.action!=='play')continue;out.plays++;
   if(action.decisionEngine==='finite-shoe'&&action.math?.complete)out.computed++;
   else if(action.math?.complete===false){out.fallback++;const reason=action.math.reason||'unknown';out.reasons[reason]=(out.reasons[reason]||0)+1;}
   else out.reference++;
  }
 }
 return out;
}
