const finite = value => Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.slice(0,80) : '';
const cards = value => Array.isArray(value) ? value.filter(c=>/^(10|[2-9AJQK])$/.test(c?.rank) && /^(H|D|C|S|HEARTS|DIAMONDS|CLUBS|SPADES)$/.test(c?.suit)).slice(0,11).map(c=>({rank:c.rank,suit:c.suit})) : [];
const mine = table => table?.seats?.find(seat=>seat?.mine);
const handAt = seat => Number.isSafeInteger(seat?.activeHandIndex) ? seat.hands?.[seat.activeHandIndex] : null;
const mathMetadata = value => value && typeof value==='object' ? {complete:value.complete===true,reason:['coverage','rules','hole','other-seats','invalid','budget','exhausted','worker','timeout','busy','stopped'].includes(value.reason)?value.reason:null,scope:value.scope==='whole-seat'?'whole-seat':null,origin:['new-private-table','observed-renewal'].includes(value.origin)?value.origin:null,ruleSource:['server-announced','public-client'].includes(value.ruleSource)?value.ruleSource:null,remaining:Number.isSafeInteger(value.remaining)&&value.remaining>=0&&value.remaining<=312?value.remaining:null,runningCount:finite(value.runningCount),shuffleCount:finite(value.shuffleCount),chosenEv:finite(value.chosenEv)} : null;
const bettingMetadata = value => value?.policy==='edge' ? {policy:'edge',complete:value.complete===true,reason:['edge','minimum','coverage','rules','reserve','other-seats','invalid','budget','exhausted','worker','timeout','busy','stopped','deadline','unavailable'].includes(value.reason)?value.reason:null,lowerBound:finite(value.lowerBound),meanPeek:finite(value.meanPeek),meanNoPeek:finite(value.meanNoPeek),secondMoment:finite(value.secondMoment),samples:Number.isSafeInteger(value.samples)&&value.samples>=128&&value.samples<=500000?value.samples:null,confidence:value.confidence===.99?.99:null,unit:Number.isSafeInteger(value.unit)&&value.unit>0?value.unit:null,ceiling:Number.isSafeInteger(value.ceiling)&&value.ceiling>0&&value.ceiling<=5000000?value.ceiling:null,reserveCovered:value.reserveCovered===true,remaining:Number.isSafeInteger(value.remaining)&&value.remaining>=0&&value.remaining<=312?value.remaining:null,shuffleCount:finite(value.shuffleCount),origin:['new-private-table','observed-renewal'].includes(value.origin)?value.origin:null}:null;
const aiMetadata = action => ({decisionEngine:['table','table-compare','table-fallback','laya','laya-validated','finite-shoe'].includes(action?.decisionEngine)?action.decisionEngine:null,aiMove:['hit','stand','double','split'].includes(action?.aiMove)?action.aiMove:null,progression:['win-double-loss-half','fixed','edge'].includes(action?.progression)?action.progression:null,betting:bettingMetadata(action?.betting),math:mathMetadata(action?.math),aiLatencyMs:Number.isFinite(action?.aiLatencyMs)&&action.aiLatencyMs>=0?Math.round(action.aiLatencyMs):null});
const turnKey = table => {
  const seat=mine(table), hand=handAt(seat);
  return table?.phase==='acting' && hand?.status==='playing' ? JSON.stringify([seat.turnId,seat.activeHandIndex,cards(hand.cards)]) : null;
};
function assertCurrentBlackjackAction(table, action, payload, now=Date.now()) {
  if (!['bet','play'].includes(action)) return;
  if (!table || payload.tableId != null && payload.tableId!==table.tableId || payload.roundNumber != null && payload.roundNumber!==table.roundNumber) throw new Error('A mesa ou ronda mudou enquanto o pedido aguardava.');
  const seat=mine(table), hand=handAt(seat);
  if (action==='bet') {
    if (table.phase!=='betting' || seat?.status!=='betting') throw new Error('A janela de aposta já terminou.');
    if (payload.bet<(table.minBet??1) || payload.bet>(table.maxBet??5000000)) throw new Error('Aposta fora dos limites da mesa.');
  } else {
    if (table.phase!=='acting' || seat?.turnId!==payload.turnId || hand?.status!=='playing') throw new Error('A vez mudou enquanto o pedido aguardava.');
    if (payload.move==='double' && (hand.cards.length!==2 || hand.splitAces)) throw new Error('Dobrar já não é permitido nesta mão.');
    if (payload.move==='split') {
      const value=c=>['10','J','Q','K'].includes(c?.rank)?10:c?.rank;
      if (hand.cards.length!==2 || hand.splitAces || seat.hands.length>=4 || value(hand.cards[0])!==value(hand.cards[1])) throw new Error('Dividir já não é permitido nesta mão.');
    }
  }
  const deadline=action==='play' ? seat?.actionDeadlineAt : table.deadlineAt;
  if (Number.isFinite(deadline) && deadline-now<150) throw new Error('O prazo desta ação terminou enquanto o pedido aguardava.');
}
function outcomeReason(table, seat) {
  if (!Number.isFinite(seat?.netProfit) || table.phase!=='result') return null;
  if (seat.netProfit>0) return seat.hands.some(h=>h.result==='blackjack')?'blackjack':table.dealerBust?'dealer-bust':'player-wins';
  if (seat.netProfit===0) return 'push';
  if (seat.hands.length>1) return 'split-net-loss';
  if (seat.hands[0]?.status==='bust') return 'player-bust';
  if (table.dealerBlackjack) return 'dealer-blackjack';
  return 'dealer-higher';
}
function safeAuditRound(row) {
  return {accountId:text(row?.accountId),tableId:text(row?.tableId),roundNumber:finite(row?.roundNumber),shuffleCount:finite(row?.shuffleCount),phase:text(row?.phase),startedAt:text(row?.startedAt),netProfit:finite(row?.netProfit),reason:text(row?.reason),dealerCards:cards(row?.dealerCards),dealerValue:finite(row?.dealerValue),turnsWithoutCommand:finite(row?.turnsWithoutCommand)||0,
    hands:Array.isArray(row?.hands)?row.hands.slice(0,4).map(hand=>({cards:cards(hand?.cards),status:text(hand?.status),result:text(hand?.result),value:finite(hand?.value),bet:finite(hand?.bet),payout:finite(hand?.payout),fromSplit:hand?.fromSplit===true})):[],
    actions:Array.isArray(row?.actions)?row.actions.slice(0,50).map(action=>({action:['bet','play'].includes(action?.action)?action.action:null,move:['hit','stand','double','split'].includes(action?.move)?action.move:null,source:action?.source==='auto'?'auto':'manual',...aiMetadata(action),bet:finite(action?.bet),cards:cards(action?.cards),dealerCard:cards(action?.dealerCard).slice(0,1),handIndex:finite(action?.handIndex),fromSplit:action?.fromSplit===true,splitAces:action?.splitAces===true,handCount:finite(action?.handCount),tokens:finite(action?.tokens),sentAt:text(action?.sentAt),deadlineMarginMs:finite(action?.deadlineMarginMs),transitionMs:finite(action?.transitionMs)})):[]};
}
function createBlackjackAudit({now=Date.now,emit=()=>{}}={}) {
  const rows=new Map();
  function get(accountId,table) {
    if (!table?.tableId || !Number.isSafeInteger(table.roundNumber) || !mine(table)) return null;
    // The public server keeps N during the betting window for hand N+1.
    // See the owner's 2026-10-08 export: betting 0 -> acting 1 -> result 1 -> betting 1.
    const roundNumber=table.roundNumber+(table.phase==='betting'?1:0);
    const key=`${accountId}:${table.tableId}:${roundNumber}`;
    if (!rows.has(key)) rows.set(key,{accountId,tableId:text(table.tableId),roundNumber,phase:table.phase,startedAt:new Date(now()).toISOString(),netProfit:null,reason:null,dealerCards:[],hands:[],actions:[],turnsWithoutCommand:0,openTurn:null});
    if(rows.size>400) rows.delete(rows.keys().next().value);
    return rows.get(key);
  }
  const publicRow=safeAuditRound;
  return {
    observe(accountId,table) {
      const row=get(accountId,table);if(!row)return;
      if(Number.isFinite(row.netProfit)&&table.phase!=='result')return;
      const seat=mine(table), key=turnKey(table);
      if(row.openTurn && row.openTurn.key!==key) {
        const sent=row.actions.filter(a=>a.turnKey===row.openTurn.key);
        if(!sent.length)row.turnsWithoutCommand++;
        for(const action of sent) if(action.transitionMs==null) action.transitionMs=Math.max(0,now()-action.sentAtMs);
      }
      for(const action of row.actions) if(action.action==='bet' && action.transitionMs==null && (table.phase!=='betting' || seat.status!=='betting'))action.transitionMs=Math.max(0,now()-action.sentAtMs);
      row.openTurn=key?{key}:null;
      row.shuffleCount=finite(table.shuffleCount);row.phase=text(table.phase);row.dealerCards=cards(table.dealerCards);row.dealerValue=finite(table.dealerValue);
      row.hands=(seat.hands||[]).slice(0,4).map(h=>({cards:cards(h.cards),status:text(h.status),result:text(h.result),value:finite(h.value),bet:finite(h.bet),payout:finite(h.payout),fromSplit:h.fromSplit===true}));
      if(table.phase==='result' && Number.isFinite(seat.netProfit)){row.netProfit=seat.netProfit;row.reason=outcomeReason(table,seat);}
      emit(publicRow(row));
    },
    command(accountId,action,payload,table) {
      if(!['play','bet'].includes(action))return;
      const row=get(accountId,table);if(!row)return;
      const seat=mine(table), hand=handAt(seat), deadline=action==='play'?seat.actionDeadlineAt:table.deadlineAt;
      row.actions.push({action,move:action==='play'?text(payload.move):null,source:payload.source==='auto'?'auto':'manual',...aiMetadata(payload),bet:finite(action==='bet'?payload.bet:hand?.bet),cards:cards(hand?.cards),dealerCard:cards(table.dealerCards).slice(0,1),handIndex:finite(seat.activeHandIndex),fromSplit:Boolean(hand?.fromSplit),splitAces:Boolean(hand?.splitAces),handCount:seat.hands?.length||0,tokens:finite(payload.tokensAtDecision),sentAt:new Date(now()).toISOString(),sentAtMs:now(),deadlineMarginMs:Number.isFinite(deadline)?deadline-now():null,transitionMs:null,turnKey:turnKey(table)});
      if(row.actions.length>50)row.actions.shift();
      emit(publicRow(row));
    },
    history(accountId) {return [...rows.values()].filter(row=>!accountId||row.accountId===accountId).reverse().map(publicRow);},
  };
}
module.exports={createBlackjackAudit,assertCurrentBlackjackAction,safeAuditRound};
