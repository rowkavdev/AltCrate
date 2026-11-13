import {resolveBlackjackRules} from './blackjackRules.js';
export const blackjackCardValue = (card) => ['10', 'J', 'Q', 'K'].includes(card?.rank) ? 10 : card?.rank === 'A' ? 11 : Number(card?.rank);

export function blackjackAdvice(hand, dealerCard, canDouble, canSplit) {
  const cards = hand?.cards;
  if (!Array.isArray(cards) || cards.length < 2 || !dealerCard) return null;
  const dealer = blackjackCardValue(dealerCard);
  if (!Number.isFinite(dealer) || dealer < 2 || dealer > 11) return null;
  const ranks = cards.map(blackjackCardValue);
  if (ranks.some((value) => !Number.isInteger(value) || value < 2 || value > 11)) return null;
  const pair = canSplit && cards.length === 2 && ranks[0] === ranks[1] ? ranks[0] : null;
  if (pair === 11 || pair === 8 || pair === 9 && ((dealer >= 2 && dealer <= 6) || dealer === 8 || dealer === 9) || pair === 7 && dealer <= 7 || pair === 6 && dealer <= 6 || pair === 4 && dealer >= 5 && dealer <= 6 || (pair === 2 || pair === 3) && dealer <= 7) return 'Dividir';
  let total = ranks.reduce((sum, value) => sum + value, 0);
  let usableAces = ranks.filter((value) => value === 11).length;
  while (total > 21 && usableAces) { total -= 10; usableAces--; }
  const soft = usableAces > 0;
  if (soft) {
    if (total >= 19) return 'Parar';
    if (total === 18) return dealer >= 3 && dealer <= 6 && canDouble ? 'Dobrar' : dealer <= 8 ? 'Parar' : 'Pedir carta';
    const double = total === 12 ? dealer === 6 : total === 17 ? dealer >= 3 && dealer <= 6 : total >= 15 ? dealer >= 4 && dealer <= 6 : dealer >= 5 && dealer <= 6;
    return double && canDouble ? 'Dobrar' : 'Pedir carta';
  }
  if (total >= 17) return 'Parar';
  if (total >= 13) return dealer <= 6 ? 'Parar' : 'Pedir carta';
  if (total === 12) return dealer >= 4 && dealer <= 6 ? 'Parar' : 'Pedir carta';
  if (canDouble && (total === 11 && dealer <= 10 || total === 10 && dealer <= 9 || total === 9 && dealer >= 3 && dealer <= 6)) return 'Dobrar';
  return 'Pedir carta';
}

export function nextBlackjackCommand({ connected, events = {}, tokens, amount, pending, now = Date.now() }) {
  if (!connected || pending) return null;
  if(!resolveBlackjackRules(events.blackjackConfig).compatible)return {stop:'As regras anunciadas pelo servidor mudaram. Confirma as regras antes de continuar.'};
  const table = events.blackjackTableState;
  if (!table?.tableId) return events.blackjackTableJoined?.tableId || events.blackjackMySeat?.tableId ? null : { key: 'create', action: 'create', payload: {} };
  const seat = table.seats?.find((entry) => entry?.mine);
  if (!seat) {
    const code = table.code || (events.blackjackTableJoined?.tableId === table.tableId ? events.blackjackTableJoined?.code : null) || (events.blackjackMySeat?.tableId === table.tableId ? events.blackjackMySeat?.code : null);
    if (!code) return null;
    const count = Math.min(10, table.maxSeats || 5);
    const seatIndex = Array.from({ length: count }, (_, index) => index).find((index) => !table.seats?.[index]);
    return seatIndex === undefined ? { stop: 'A mesa não tem lugares livres.' } : { key: `${table.tableId}:sit`, action: 'sit', payload: { tableId: table.tableId, code, seatIndex } };
  }
  if (!Number.isSafeInteger(table.roundNumber)) return null;
  if (table.phase === 'betting' && seat.status === 'betting') {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 5000000 || amount < (table.minBet ?? 1) || amount > (table.maxBet ?? 5000000)) return { stop: 'A aposta não respeita os limites da mesa.' };
    if (!Number.isFinite(tokens)) return null;
    if (tokens < amount) return { stop: `Saldo insuficiente para apostar ${amount} tokens.` };
    if (Number.isFinite(table.deadlineAt) && table.deadlineAt - now < 1500) return null;
    return { key: `${table.tableId}:${table.roundNumber}:bet`, action: 'bet', payload: { bet: amount } };
  }
  if (table.phase !== 'acting' || seat.turnId == null) return null;
  const handIndex = seat.activeHandIndex;
  const hand = Number.isSafeInteger(handIndex) ? seat.hands?.[handIndex] : null;
  if (hand?.status !== 'playing' || !Array.isArray(hand.cards) || hand.cards.length < 2) return null;
  if (Number.isFinite(seat.actionDeadlineAt) && seat.actionDeadlineAt - now < 1200) return null;
  const extraStake = Number.isFinite(hand.bet) && hand.bet > 0 ? hand.bet : seat.bet;
  const canSpendMore = Number.isFinite(tokens) && Number.isFinite(extraStake) && extraStake > 0 && tokens >= extraStake;
  const canDouble = canSpendMore && hand.cards.length === 2 && !hand.splitAces;
  const canSplit = canDouble && seat.hands.length < 4 && (hand.cards[0].rank === hand.cards[1].rank || blackjackCardValue(hand.cards[0]) === 10 && blackjackCardValue(hand.cards[1]) === 10);
  const advice = blackjackAdvice(hand, table.dealerCards?.[0], canDouble, canSplit);
  if (!advice) return null;
  const move = { 'Pedir carta': 'hit', Parar: 'stand', Dobrar: 'double', Dividir: 'split' }[advice];
  const cards = hand.cards.map((card) => `${card.rank}${card.suit}`).join(',');
  return { key: `${table.tableId}:${table.roundNumber}:${seat.turnId}:${handIndex}:${cards}`, action: 'play', payload: { move, turnId: seat.turnId } };
}

export function createBlackjackAutoRunner({ send, choosePlay, chooseBet, onStop = () => {}, onHalt = () => {}, onAction = () => {}, onStake = () => {}, now = Date.now }) {
  let active = false, runId = null, amount = null, inFlight = false, waiting = null, latest = null;
  let progression = 'fixed', wagerRound = null, ceiling = null;
  let confirmedResults = new Map();
  let seen = new Set();
  const observedKey = context => {
    const events=context.events||{}, table=events.blackjackTableState, seat=table?.seats?.find(s=>s?.mine);
    return JSON.stringify([table?.tableId,table?.roundNumber,table?.phase,seat?.status,seat?.bet,seat?.turnId,seat?.activeHandIndex,seat?.hands?.map(hand=>[hand.status,hand.bet,hand.cards]),events.blackjackTableJoined?.tableId,events.blackjackMySeat?.tableId]);
  };
  const runner = {
    get active() { return active; },
    start(id, stake, options = {}) {
      if (active && runId === id) return;
      active = true; runId = id; amount = stake; waiting = null; latest = null; seen = new Set();
      progression = ['win-double-loss-half','edge'].includes(options.progression) ? options.progression : 'fixed';
      ceiling=stake;
      wagerRound = null; onStake({ amount:progression==='edge'?null:amount, reason: progression==='edge'?'planning':'initial', progression, ceiling });
      confirmedResults = new Map();
    },
    stop(reason = null) {
      if (!active) return;
      active = false; waiting = null;
      onHalt(reason);
      if (reason) onStop(reason);
    },
    recordResult(table) {
      const seat=table?.seats?.find(s=>s?.mine);
      if(!active||table?.phase!=='result'||!Number.isSafeInteger(table.roundNumber)||!Number.isFinite(seat?.netProfit)||!seat.hands?.length)return;
      confirmedResults.set(`${table.tableId}:${table.roundNumber}`,{profit:seat.netProfit,min:table.minBet,max:table.maxBet});
      if(confirmedResults.size>40)confirmedResults.delete(confirmedResults.keys().next().value);
    },
    async observe(context) {
      latest = context;
      if (!active) return;
      const tableNow = context.events?.blackjackTableState;
      runner.recordResult(tableNow);
      if(inFlight)return;
      if (progression !== 'fixed' && wagerRound && tableNow?.tableId === wagerRound.tableId) {
        const result = confirmedResults.get(`${wagerRound.tableId}:${wagerRound.roundNumber}`);
        if (result) {
          const profit = result.profit;
          const min = Math.max(1, Math.ceil(result.min ?? 1));
          const max = Math.min(5000000, Math.floor(result.max ?? 5000000));
          if(progression==='win-double-loss-half')amount = Math.max(min, Math.min(max, profit > 0 ? amount * 2 : profit < 0 ? Math.floor(amount / 2) : amount));
          const settledRound = wagerRound.roundNumber;
          confirmedResults.delete(`${wagerRound.tableId}:${settledRound}`);wagerRound = null;
          if(progression==='win-double-loss-half')onStake({ amount, reason: profit > 0 ? 'win' : profit < 0 ? 'loss' : 'push', progression, roundNumber: settledRound });
        } else if (tableNow.phase === 'betting' && tableNow.roundNumber >= wagerRound.roundNumber) {
          runner.stop('Falta o resultado confirmado da ronda anterior para ajustar a aposta.'); return;
        }
      } else if (progression !== 'fixed' && wagerRound && tableNow?.tableId && tableNow.tableId !== wagerRound.tableId) {
        runner.stop('A mesa mudou antes de confirmar o resultado da aposta.'); return;
      }
      if(context.pending)return;
      const probeAmount=progression==='edge'?Math.max(1,Math.ceil(tableNow?.minBet??1)):amount;
      if(progression==='edge'&&probeAmount>ceiling){runner.stop('O teto por ronda é inferior ao mínimo da mesa.');return;}
      let decision = nextBlackjackCommand({ ...context, amount:probeAmount, now: now() });
      if (waiting && !context.connected) {
        if (now() - waiting.sentAt >= 15000) runner.stop('Ligação perdida sem confirmação do servidor.');
        return;
      }
      const currentTable = context.events?.blackjackTableState;
      const currentRound = `${currentTable?.tableId}:${currentTable?.roundNumber}`;
      if (waiting?.action === 'bet' && currentRound === waiting.round && decision?.stop?.startsWith('Saldo insuficiente')) {
        if (now() - waiting.sentAt >= 15000) runner.stop('Sem confirmação do servidor após 15 segundos.');
        return;
      }
      if (waiting && observedKey(context) !== waiting.observedKey) waiting = null;
      if (waiting && now() - waiting.sentAt >= 15000) { runner.stop('Sem confirmação do servidor após 15 segundos.'); return; }
      if (decision?.stop) { runner.stop(decision.stop); return; }
      if (!decision?.key || seen.has(decision.key)) return;
      seen.add(decision.key);
      if (seen.size > 500) seen = new Set([...seen].slice(-250));
      const dispatchedRun = runId;
      inFlight = true;
      try {
        if(decision.action==='bet'&&progression==='edge') {
          const min=Math.max(1,Math.ceil(currentTable.minBet??1));
          let plan={amount:min,reason:'deadline',reserveCovered:context.tokens>=8*min,betting:{policy:'edge',complete:false,reason:'deadline',ceiling,unit:min,reserveCovered:context.tokens>=8*min}};
          const enoughTime=!Number.isFinite(currentTable.deadlineAt)||currentTable.deadlineAt-now()>=3500;
          if(enoughTime&&chooseBet)try {plan=await chooseBet(context,{ceiling});}catch {plan={amount:min,reason:'unavailable',reserveCovered:context.tokens>=8*min,betting:{policy:'edge',complete:false,reason:'unavailable',ceiling,unit:min,reserveCovered:context.tokens>=8*min}};}
          if(!active||runId!==dispatchedRun)return;
          const latestTable=latest.events?.blackjackTableState;
          const current=nextBlackjackCommand({...latest,amount:min,now:now()});
          if(current?.key!==decision.key||latest.tokens!==context.tokens||latestTable?.shuffleCount!==currentTable.shuffleCount){seen.delete(decision.key);return;}
          const bet=plan?.amount;
          if(!Number.isSafeInteger(bet)||bet<min||bet>ceiling||bet>(currentTable.maxBet??5000000)||bet>latest.tokens){runner.stop('Sem saldo ou limite válido para a aposta calculada.');return;}
          if(plan.reason==='edge'&&(!plan.reserveCovered||bet*8>latest.tokens)){runner.stop('A aposta calculada não deixa saldo para as mãos adicionais.');return;}
          amount=bet;onStake({...plan,amount:bet,progression,ceiling});
          decision={...current,payload:{...current.payload,bet,betting:plan.betting}};
        }
        if(decision.action==='play'&&choosePlay) {
          let chosen;
          const seatAtStart=context.events.blackjackTableState.seats.find(s=>s?.mine);
          const enoughTime=!Number.isFinite(seatAtStart?.actionDeadlineAt)||seatAtStart.actionDeadlineAt-now()>=3500;
          if(enoughTime)try {chosen=await choosePlay(context,decision);}catch {chosen=null;}
          if(!active||runId!==dispatchedRun)return;
          const current=nextBlackjackCommand({...latest,amount,now:now()});
          if(current?.key!==decision.key)return;
          const table=latest.events.blackjackTableState,seat=table.seats.find(s=>s?.mine),hand=seat.hands[seat.activeHandIndex];
          const extra=hand.bet||seat.bet, funded=Number.isFinite(extra)&&extra>0&&latest.tokens>=extra;
          const double=funded&&hand.cards.length===2&&!hand.splitAces;
          const split=double&&seat.hands.length<4&&blackjackCardValue(hand.cards[0])===blackjackCardValue(hand.cards[1]);
          const legal=['hit','stand',...(double?['double']:[]),...(split?['split']:[])];
          decision={...current,payload:{...current.payload,decisionEngine:'table-fallback'}};
          if(chosen&&legal.includes(chosen.move))decision.payload={...decision.payload,move:chosen.move,decisionEngine:['laya','laya-validated','table','finite-shoe'].includes(chosen.engine)?chosen.engine:'table-compare',...(chosen.engine==='table'||chosen.engine==='finite-shoe'?{}:{aiMove:chosen.aiMove||chosen.move,aiLatencyMs:chosen.latencyMs}),...(chosen.math?{math:chosen.math}:{})};
        }
        if(!active||runId!==dispatchedRun)return;
        if(decision.action==='bet'&&progression!=='fixed')decision={...decision,payload:{...decision.payload,progression}};
        onAction(decision);
        const sent = await send(decision.action, decision.payload);
        if (active && runId === dispatchedRun) {
          if (!sent) runner.stop('O servidor ou a app recusou a ação automática.');
          else {
            if (decision.action === 'bet' && progression !== 'fixed') wagerRound = {tableId:context.events.blackjackTableState.tableId,roundNumber:context.events.blackjackTableState.roundNumber+1};
            waiting = { key: decision.key, observedKey:observedKey(context), action: decision.action, round: `${context.events?.blackjackTableState?.tableId}:${context.events?.blackjackTableState?.roundNumber}`, sentAt: now() };
          }
        }
      } catch (error) {
        if (active && runId === dispatchedRun) runner.stop(String(error?.message || error));
      } finally {
        inFlight = false;
        if (active && latest !== context) await runner.observe(latest);
      }
    },
  };
  return runner;
}
