import {accountIndex} from './workspaceViewModel.js';
import {t,getLocale} from './language.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, CircleAlert, Coins, Expand, Gamepad2, Grid2X2, RefreshCw, Search, Settings2, Shrink, Sparkles, Square, UsersRound } from 'lucide-react';
import SocketGame from './SocketGame.jsx';
import { GameVisual } from './GameVisual.jsx';
import { addBlackjackResult, eligibleBlackjackBet, summarizeBlackjackResults } from './blackjackStats.js';
import { createBlackjackAutoRunner, blackjackCardValue } from './blackjackAuto.js';
import './games.css';
import './gamesWorkspace.css';
import {filterGameTables, resolveGameTables, selectedBlackjackIds} from './gameWorkspace.js';
import {GameAccountResults, GameControlDesk, GameSessionSummary, GameTablesManager} from './components/GamesWorkspaceControls.jsx';
import {gameColumnsForWidth,upgradeTargetReady,gameInitialBet} from './gameLayout.js';
import {useGameField} from './useGameField.js';
import BlackjackHistory from './BlackjackHistory.jsx';
import LocalAiPanel from './LocalAiPanel.jsx';
import { validateLocalProposal } from './blackjackEv.js';
import {createShoeTracker} from './blackjackResearch.js';
import {chooseFiniteMove} from './blackjackFinite.js';
import {createFiniteEvaluator} from './finiteClient.js';
import {planAdvantageStake} from './blackjackEdge.js';
import {resolveBlackjackRules,jointStateForSeat} from './blackjackRules.js';
import PayoutReview, {ShoeReadout,RulesReadout,FiniteSelfCheck,EngineCoverage,SimulationReadout,EdgeReadout} from './BlackjackResearchPanel.jsx';

const games = [
  ['casebattle', 'Casebattle'], ['jackpot', 'Jackpot'], ['coinflip', 'Coinflip'],
  ['upgrade', 'Upgrade'], ['dice', 'Dice'], ['guesstherank', 'Guess the Rank'],
  ['blackjack', 'Blackjack'], ['plinko', 'Plinko'], ['crash', 'Crash'],
];
const socketGames = new Set(['casebattle', 'jackpot', 'coinflip', 'blackjack', 'crash']);
const money = (n) => Number.isFinite(n) ? n.toLocaleString(getLocale(), { maximumFractionDigits: 2 }) : '—';

function GameCard({ account, index, focused, onFocus, registerBet, stats, autoRun, autoStoppedReason, onAutoStop, ui, onUiChange, selected, onSelectedChange, selectionLocked, hidden }) {
  const [game, setGame] = useGameField(ui,onUiChange,'game','blackjack');
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [bet, setBet] = useGameField(ui,onUiChange,'bet','100');
  const [target, setTarget] = useGameField(ui,onUiChange,'target','50');
  const [choice, setChoice] = useGameField(ui,onUiChange,'choice','over');
  const [risk, setRisk] = useGameField(ui,onUiChange,'risk','Low');
  const [rankGame, setRankGame] = useGameField(ui,onUiChange,'rankGame','cs2');
  const [rankId, setRankId] = useGameField(ui,onUiChange,'rankId','1');
  const [targets, setTargets] = useState([]);
  const [targetId, setTargetId] = useGameField(ui,onUiChange,'targetId','');
  const [targetPrice, setTargetPrice] = useGameField(ui,onUiChange,'targetPrice','10');
  const [optionsPending, setOptionsPending] = useState(false);
  useEffect(()=>{if(game==='upgrade'&&targetId&&!upgradeTargetReady(targetId,targets))setTargetId('');},[game,targets]);
  const [autoStatus, setAutoStatus] = useState('');
  const [aiDecision, setAiDecision] = useState(null);
  const [nextStake,setNextStake]=useState(null);
  const [mathDecision,setMathDecision]=useState(null);
  const [edgeDecision,setEdgeDecision]=useState(null);
  const betPolicy=useRef(null);
  const edgeEvaluator=useRef(null);
  if(!edgeEvaluator.current)edgeEvaluator.current=createFiniteEvaluator({timeoutMs:2000});
  const shoeTracker=useRef(null);
  if(!shoeTracker.current)shoeTracker.current=createShoeTracker();
  const finiteEvaluator=useRef(null);
  if(!finiteEvaluator.current)finiteEvaluator.current=createFiniteEvaluator();
  useEffect(()=>()=>{finiteEvaluator.current.dispose();edgeEvaluator.current.dispose();},[]);
  const autoPolicy = useRef(null);
  const version = useRef(0);
  const socketRevision = useRef(0);
  const loadBusy = useRef(null);
  const loadRequest = useRef(0);
  const autoRunner = useRef(null);
  const autoSend = useRef(null);
  const autoStop = useRef(null);
  const autoContext = useRef(null);
  const latestLoad = useRef(null);
  const restoredGame = useRef(game);
  const latestGame = useRef(game);
  latestGame.current = game;

  async function load(expected = version.current, resume = false) {
    if (loadBusy.current !== null && !resume) return;
    const request=++loadRequest.current;
    loadBusy.current = request;
    const revision = socketRevision.current;
    try {
      const value = await window.caseClicker.loadGame(account.id, game, {resume});
      if (expected !== version.current || request !== loadRequest.current) return;
      if(game==='blackjack'&&revision===socketRevision.current&&value.socket?.events?.blackjackTableState)shoeTracker.current.observe(value.socket.events.blackjackTableState);
      setState((previous) => {
        const latest = revision !== socketRevision.current ? previous?.socket : value.socket;
        const stats = latest?.events?.userstats;
        return { ...value, socket: latest, tokens: stats?.tokens ?? value.tokens, money: stats?.money ?? value.money };
      });
      setError('');
    } catch (failure) {
      if (expected !== version.current || request !== loadRequest.current) return;
      setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally { if (loadBusy.current === request) loadBusy.current = null; if (expected === version.current && request === loadRequest.current) setLoading(false); }
  }

  useEffect(() => {
    const current = ++version.current;
    setState(null); setResult(null); setError(''); setTargets([]); setTargetId('');
    setBet(gameInitialBet(game,restoredGame.current===game?ui?.bet:undefined));
    restoredGame.current=game;
    const first = setTimeout(() => load(current), index * 400);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(current); }, 20000);
    const unsubscribe = window.caseClicker.onEvent((event) => {
      if (event.type !== 'socket-game-update' || event.accountId !== account.id || event.game !== game) return;
      socketRevision.current++;
      if(game==='blackjack') {
        if(event.event==='blackjackTableState'){shoeTracker.current.observe(event.data);autoRunner.current?.recordResult(event.data);}
        if(['disconnect','connect_error','blackjackTableClosed','blackjackKicked'].includes(event.event))shoeTracker.current.invalidate('Ligação ou mesa interrompida; aguarda renovação');
      }
      if (autoRunner.current?.active && ['blackjackError', 'blackjackKicked', 'blackjackTableClosed'].includes(event.event)) autoRunner.current.stop(event.data?.error || 'A mesa foi fechada pelo servidor.');
      if (event.data?.error) setResult(null);
      setState((previous) => {
        const events = { ...previous?.socket?.events, [event.event]: event.data };
        if (event.event === 'connect') delete events.connect_error;
        if (['crashState', 'crashBet', 'crashCashout', 'games', 'gamesJackpot'].includes(event.event)) {
          delete events.crashError;
          delete events.coinflipError;
          delete events.errorJackpot;
          delete events.casebattleError;
        }
        if (event.event === 'blackjackTableClosed') {
          delete events.blackjackTableState;
          delete events.blackjackTableJoined;
          delete events.blackjackMySeat;
        }
        if (event.event === 'blackjackTableState' || event.event === 'blackjackTableJoined') {
          delete events.blackjackKicked;
          delete events.blackjackError;
          delete events.blackjackTableClosed;
        }
        return { ...previous, tokens: event.event === 'userstats' ? event.data?.tokens ?? previous?.tokens : previous?.tokens, money: event.event === 'userstats' ? event.data?.money ?? previous?.money : previous?.money, socket: { connected: event.event === 'disconnect' || event.event === 'connect_error' ? false : event.event === 'connect' ? true : previous?.socket?.connected, events, phase: event.data?.phase || previous?.socket?.phase } };
      });
    });
    const visibility = () => { if (document.visibilityState === 'visible') load(current); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearTimeout(first); clearInterval(interval); unsubscribe(); document.removeEventListener('visibilitychange', visibility); if (socketGames.has(game)) window.caseClicker.leaveGame(account.id, game).catch(() => {}); version.current++; };
  }, [account.id, game]);

  async function findTargets() {
    const current = version.current;
    setOptionsPending(true); setTargets([]); setTargetId(''); setError('');
    try {
      const items = await window.caseClicker.gameOptions(account.id, 'upgrade', Number(bet), Number(targetPrice));
      if (current !== version.current) return;
      setTargets(items);
      setTargetId(items[0]?.id || '');
      if (!items.length) setError('A API não devolveu itens alvo para este valor.');
    } catch (failure) {
      if (current === version.current) setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally { if (current === version.current) setOptionsPending(false); }
  }

  async function act() {
    const current = version.current;
    const amount = Number(bet);
    if(game==='upgrade'&&!upgradeTargetReady(targetId,targets))return;
    setPending(true); setResult(null); setError('');
    try {
      const action = game === 'dice' ? 'roll' : game === 'plinko' ? 'drop' : game === 'upgrade' ? 'attempt' : state?.state?.active ? 'guess' : 'start';
      const payload = game === 'dice' ? { bet: amount, targetNumber: Number(target), playerChoice: choice } : game === 'plinko' ? { bet: amount, risk } : game === 'upgrade' ? { tokens: amount, targetId, targetPrice: Number(targetPrice) } : action === 'guess' ? { rankId: Number(rankId) } : { bet: amount, game: rankGame };
      const answer = await window.caseClicker.gameAction(account.id, game, action, payload);
      if (current !== version.current) return;
      setResult(answer);
      await load(current);
    } catch (failure) {
      if (current === version.current) setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally { if (current === version.current) setPending(false); }
  }

  async function actSocket(action, payload = {}) {
    const current = version.current;
    setPending(true); setResult(null); setError('');
    try {
      if(game==='blackjack'&&action==='create')shoeTracker.current.beginCreation();
      const table = state?.socket?.events?.blackjackTableState;
      const context = game === 'blackjack' && ['bet','play'].includes(action) ? { tableId:table?.tableId, roundNumber:table?.roundNumber, tokensAtDecision:state?.tokens } : {};
      const answer = await window.caseClicker.gameAction(account.id, game, action, { ...payload, ...context });
      if (current === version.current) setResult(answer);
      return true;
    } catch (failure) {
      if(game==='blackjack'&&action==='create')shoeTracker.current.cancelCreation();
      if (current === version.current) setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ''));
      return false;
    } finally { if (current === version.current) setPending(false); }
  }

  autoSend.current = actSocket;
  autoPolicy.current = async (context, command) => {
    const mode=autoRun?.mode || 'table';
    if(mode==='table')return {move:command.payload.move,engine:'table'};
    const table=context.events.blackjackTableState,seat=table.seats.find(s=>s?.mine),hand=seat.hands[seat.activeHandIndex];
    const funded=Number.isFinite(hand.bet)&&hand.bet>0&&context.tokens>=hand.bet;
    const canDouble=funded&&hand.cards.length===2&&!hand.splitAces;
    const canSplit=canDouble&&seat.hands.length<4&&blackjackCardValue(hand.cards[0])===blackjackCardValue(hand.cards[1]);
    const current=version.current;
    const input={cards:hand.cards.map(card=>card.rank),dealer:table.dealerCards[0].rank,canDouble,canSplit,fromSplit:hand.fromSplit===true};
    if(mode==='math') {
      const shoe=shoeTracker.current.snapshot();
      const resolved=resolveBlackjackRules(context.events.blackjackConfig);
      const reason=!resolved.compatible?'rules':!shoe.usable||table.shuffleCount!==shoe.shuffleCount?'coverage':table.dealerHoleCardHidden!==true?'hole':table.seats.filter(s=>s?.hands?.length).length!==1?'other-seats':null;
      const joint=jointStateForSeat(table,shoe,context.tokens,canDouble,canSplit,resolved.rules);
      if(reason||!joint) {
        setMathDecision({complete:false,reason:reason||'invalid'});
        return {move:command.payload.move,engine:'table',math:{complete:false,reason:reason||'invalid',remaining:shoe.remaining,shuffleCount:shoe.shuffleCount}};
      }
      const calculated=await finiteEvaluator.current.evaluate(joint);
      const move=chooseFiniteMove(calculated,command.payload.move);
      if(version.current===current)setMathDecision({...calculated,move,reference:command.payload.move});
      return {move,engine:calculated.complete?'finite-shoe':'table',math:{complete:calculated.complete,reason:calculated.reason,scope:calculated.scope,origin:shoe.origin,ruleSource:resolved.source,remaining:shoe.remaining,runningCount:shoe.runningCount,shuffleCount:shoe.shuffleCount,chosenEv:calculated.peek?.[move]}};
    }
    try {
      const answer=await window.caseClicker.localAiDecision(input);
      const checked=validateLocalProposal(input,command.payload.move,answer.move);
      const move=mode==='laya'?answer.move:mode==='hybrid'?checked.move:command.payload.move;
      if(version.current===current)setAiDecision({...answer,reference:command.payload.move,mode,chosen:move,checked});
      return {move,engine:mode==='laya'?'laya':mode==='hybrid'?'laya-validated':'table-compare',aiMove:answer.move,latencyMs:answer.latencyMs};
    }catch {
      if(version.current===current)setAiDecision({error:true});
      return null;
    }
  };
  betPolicy.current = async (context,{ceiling}) => {
    const table=context.events.blackjackTableState,shoe=shoeTracker.current.snapshot();
    const resolved=resolveBlackjackRules(context.events.blackjackConfig);
    const options={tokens:context.tokens,minBet:table.minBet??1,maxBet:table.maxBet??5000000,ceiling};
    const minimum=planAdvantageStake(options,null),current=version.current;
    const reason=!resolved.compatible?'rules':!shoe.usable||table.shuffleCount!==shoe.shuffleCount?'coverage':!minimum.reserveCovered?'reserve':table.seats.some(s=>s?.occupied&&!s.mine)?'other-seats':null;
    const estimated=reason?{complete:false,reason}:await edgeEvaluator.current.evaluate({counts:shoe.counts,rules:resolved.rules,stakeUnit:minimum.unit},{kind:'edge'});
    const plan=planAdvantageStake(options,estimated);
    if(version.current===current)setEdgeDecision({...estimated,...plan,reason:estimated.reason||plan.reason,remaining:shoe.remaining,origin:shoe.origin});
    return {...plan,betting:{policy:'edge',complete:estimated.complete,reason:estimated.reason||plan.reason,lowerBound:estimated.lowerBound,meanPeek:estimated.peek?.mean,meanNoPeek:estimated.noPeek?.mean,secondMoment:estimated.secondMoment,samples:estimated.samples,confidence:estimated.assumptions?.confidence,unit:minimum.unit,ceiling,reserveCovered:plan.reserveCovered,remaining:shoe.remaining,shuffleCount:shoe.shuffleCount,origin:shoe.origin}};
  };
  latestLoad.current = load;
  autoStop.current = onAutoStop;
  if (!autoRunner.current) autoRunner.current = createBlackjackAutoRunner({
    send: (action, payload) => autoSend.current(action, { ...payload, source:'auto' }),
    choosePlay: (context,command) => autoPolicy.current(context,command),
    chooseBet: (context,options) => betPolicy.current(context,options),
    onStop: (reason) => { setAutoStatus(reason); autoStop.current(account.id, reason); },
    onStake: stake=>setNextStake(stake),
    onHalt: () => { finiteEvaluator.current.dispose();edgeEvaluator.current.dispose();shoeTracker.current.invalidate('Mesa desligada; aguarda uma nova renovação');loadRequest.current++; loadBusy.current=null; socketRevision.current++; if(latestGame.current==='blackjack')setState(previous => previous ? {...previous, socket:{connected:false,events:{},paused:true}} : previous); window.caseClicker.leaveGame(account.id, 'blackjack').catch(() => {}); },
    onAction: (command) => setAutoStatus(command.action === 'bet' ? `Aposta de ${command.payload.bet} tokens enviada` : command.action === 'play' ? `${{ hit: 'Pedir carta', stand: 'Parar', double: 'Dobrar', split: 'Dividir' }[command.payload.move]} enviado` : command.action === 'create' ? 'A abrir mesa privada' : 'A ocupar lugar'),
  });

  const enabled = ['dice', 'plinko', 'guesstherank', 'upgrade'].includes(game) && state?.supported;
  const min = game === 'dice' ? 100 : game === 'upgrade' ? 0.01 : 1;
  const amount = Number(bet);
  const validBet = (game === 'upgrade' ? Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6 : Number.isSafeInteger(amount)) && amount >= min && amount <= (game === 'dice' ? 10000000 : game === 'upgrade' ? 1000000 : 5000000) && amount <= Number(state?.tokens);
  const validTargetPrice = Number.isFinite(Number(targetPrice)) && Number(targetPrice) >= amount * 1.1 && Number(targetPrice) <= 10000000;
  const guessActive = game === 'guesstherank' && state?.state?.active;
  const autoActive = Boolean(autoRun?.ids.includes(account.id) && !autoStoppedReason);
  const autoDisplay = !state?.socket?.connected ? 'A aguardar ligação' : state?.socket?.events?.blackjackTableState?.phase === 'result' ? 'A aguardar próxima ronda' : autoStatus;
  autoContext.current = { connected: state?.socket?.connected, events: state?.socket?.events || {}, tokens: state?.tokens == null ? null : Number(state.tokens), pending };
  useEffect(() => {
    if (!autoActive) { autoRunner.current.stop(); return undefined; }
    if (game !== 'blackjack') { onAutoStop(account.id, 'Seleciona Blackjack neste cartão antes de iniciar.'); return undefined; }
    autoRunner.current.start(autoRun.id, autoRun.amount,{progression:autoRun.progression});
    setMathDecision(null);setAiDecision(null);setEdgeDecision(null);
    setAutoStatus('A aguardar estado da mesa');
    latestLoad.current(version.current, true);
    return () => autoRunner.current.stop();
  }, [autoRun?.id, autoActive, game]);
  useEffect(() => { if (autoActive && game === 'blackjack') autoRunner.current.observe(autoContext.current); }, [autoActive, game, state?.socket, state?.tokens, pending]);
  useEffect(() => {
    if (!autoActive || game !== 'blackjack') return undefined;
    const interval = setInterval(() => autoRunner.current.observe(autoContext.current), 1000);
    return () => clearInterval(interval);
  }, [autoActive, game]);
  useEffect(() => {
    registerBet(account.id, async (amount) => {
      if (autoActive || game !== 'blackjack' || !eligibleBlackjackBet({ connected: state?.socket?.connected, table: state?.socket?.events?.blackjackTableState, tokens: Number(state?.tokens), pending }, amount)) return { skipped: true };
      return { sent: await actSocket('bet', { bet: amount }) };
    });
    return () => registerBet(account.id, null);
  });
  return <article hidden={hidden} data-account-id={account.id} className={`game-card ${focused ? 'focused' : ''} ${selected && game==='blackjack' ? 'game-card-selected' : ''}`}>
    <div className="game-card-head"><label className="game-card-select"><input type="checkbox" checked={selected && game==='blackjack'} disabled={selectionLocked || game!=='blackjack'} onChange={onSelectedChange} aria-label={t(`Selecionar ${account.label} para Blackjack`)}/></label><div className="avatar">{account.label.slice(0, 2).toUpperCase()}</div><div className="game-card-identity"><strong title={account.label}>{account.label}</strong><small><span className={`games-live-dot ${autoActive || state?.socket?.connected ? 'active' : ''}`}/>{t(autoActive ? 'Automático ativo' : loading ? 'A ligar…' : state?.socket?.paused ? 'Ligação pausada' : state?.socket?.connected ? 'Mesa ligada' : state ? 'Jogada manual' : 'Sem leitura')}</small></div><button type="button" onClick={onFocus} aria-label={t(focused ? `Reduzir ${account.label}` : `Ampliar ${account.label}`)}>{focused ? <Shrink size={16} /> : <Expand size={16} />}</button></div>
    <label className="game-label">{t("Jogo")}<select aria-label={t("Jogo")} value={game} disabled={autoActive} onChange={(event) => setGame(event.target.value)}>{games.map(([id, name]) => <option key={id} value={id}>{t(name)}</option>)}</select></label>
    <GameVisual game={game} socket={state?.socket} result={result} target={target} choice={choice} risk={risk} />
    <div className="game-balance"><span className="game-balance-icon"><Coins size={17} /></span><div><small>{t('Tokens disponíveis')}</small><strong>{money(state?.tokens)}</strong></div><span className="game-money">${money(state?.money)}</span><button type="button" onClick={() => load(version.current, true)} disabled={loading || pending} aria-label={t(`Atualizar ${account.label}`)}><RefreshCw size={15} /></button></div>
    {state?.availability&&<p className="game-cost" role="status">{t(state.availability.disabled?'Jogo desativado pelo servidor':state.availability.limitKnown?`${state.availability.remaining} jogadas disponíveis`:'Limites indisponíveis — atualiza para voltar a verificar.')}</p>}
    {game==='blackjack'&&state?.socket?.paused&&<p className="game-cost">{t("Mesa desligada. A atualização automática não volta a ligá-la. Usa Iniciar automático ou Atualizar para voltar.")}</p>}
    {socketGames.has(game) && state?.supported ? <SocketGame ui={ui} onUiChange={onUiChange} game={game} socket={state.socket} bet={bet} setBet={setBet} validBet={validBet} pending={pending} act={actSocket} autoActive={autoActive} /> : enabled ? <div className="game-controls">
      {!guessActive && <label>{t("Aposta em tokens")}<input type="number" min={min} max={game === 'dice' ? 10000000 : game === 'upgrade' ? 1000000 : 5000000} step={game === 'upgrade' ? '0.01' : '1'} value={bet} onChange={(event) => { setBet(event.target.value); if (game === 'upgrade') { setTargets([]); setTargetId(''); } }} /></label>}
      {game === 'dice' && <div className="game-controls-row"><label>{t("Alvo (1–99)")}<input type="number" min="1" max="99" step="1" value={target} onChange={(event) => setTarget(event.target.value)} /></label><label>{t("Escolha")}<select value={choice} onChange={(event) => setChoice(event.target.value)}><option value="over">{t("Acima")}</option><option value="under">{t("Abaixo")}</option></select></label></div>}
      {game === 'plinko' && <label>{t("Risco")}<select value={risk} onChange={(event) => setRisk(event.target.value)}>{['Low', 'Medium', 'High', 'Extreme'].map((value) => <option key={value}>{t(value)}</option>)}</select></label>}
      {game === 'guesstherank' && (guessActive ? <>{state.state.videoId ? <iframe className="rank-video" title={t(`Vídeo da ronda de ${account.label}`)} src={`https://www.youtube-nocookie.com/embed/${state.state.videoId}`} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : <div className="game-unavailable">{t("O vídeo desta ronda não tem um URL YouTube validado. Palpite desativado.")}</div>}<label>{t("Classificação")}<select value={rankId} onChange={(event) => setRankId(event.target.value)}>{(state.state.game === 'cs2' ? [1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7, 8]).map((value) => <option key={value} value={value}>{t("Rank ")}{t(value)}</option>)}</select></label></> : <label>{t("Versão")}<select value={rankGame} onChange={(event) => setRankGame(event.target.value)}><option value="cs2">{t("CS2")}</option><option value="csgo">{t("CS:GO")}</option></select></label>)}
      {game === 'upgrade' && <><label>{t("Preço alvo ($ virtual)")}<input type="number" min={Math.ceil(amount * 1.1 * 100) / 100} max="10000000" step="0.01" value={targetPrice} onChange={(event) => { setTargetPrice(event.target.value); setTargets([]); setTargetId(''); }} /></label><button type="button" className="game-secondary" disabled={pending || loading || optionsPending || !validBet || !validTargetPrice} onClick={findTargets}>{t(optionsPending ? 'A procurar…' : 'Procurar itens alvo')}</button>{targets.length > 0 && <label>{t("Item alvo")}<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{targets.map((item) => <option key={item.id} value={item.id}>{item.name} · ${t(money(item.price))}</option>)}</select></label>}<small className="game-cost">{t("Usa apenas tokens desta conta. Nenhum item teu é enviado no pedido.")}</small></>}
      <button type="button" className="primary-button" disabled={pending || loading || optionsPending || state?.availability?.disabled || (!guessActive && state?.availability && (!state.availability.limitKnown || state.availability.remaining<=0)) || (!guessActive && !validBet) || (game === 'dice' && (!Number.isSafeInteger(Number(target)) || Number(target) < 1 || Number(target) > 99)) || (guessActive && (!state.state.videoId || (state.state.game === 'cs2' && (Number(rankId) < 1 || Number(rankId) > 7)))) || (game === 'upgrade' && (!upgradeTargetReady(targetId,targets) || !validTargetPrice))} onClick={act}><Sparkles size={16} /> {t(pending ? 'A aguardar servidor…' : game === 'dice' ? `Lançar por ${money(amount)} tokens` : game === 'plinko' ? `Soltar por ${money(amount)} tokens` : game === 'upgrade' ? `Tentar upgrade por ${money(amount)} tokens` : guessActive ? 'Enviar palpite' : `Iniciar ronda por ${money(amount)} tokens`)}</button>
      <small className="game-cost">{t("Jogada manual. O servidor calcula e confirma o resultado.")}</small>
    </div> : <div className="game-unavailable"><CircleAlert size={18} /><strong>{t(error ? 'Jogo indisponível nesta sessão' : 'A ligar ao jogo')}</strong><p>{t(error ? 'Verifica a sessão da conta e volta a atualizar.' : 'Atualiza este cartão se a ligação não abrir.')}</p></div>}
    {result && <div className={`game-result ${result.verified ? 'verified' : ''}`} role="status"><strong>{t(result.sent ? 'Ação enviada; aguarda confirmação no estado do jogo' : result.verified ? result.action === 'start' ? 'Ronda confirmada pelo servidor' : 'Resultado confirmado pelo servidor' : 'Pedido aceite; resposta sem campos de resultado esperados')}</strong>{result.verified && <span>{t(game === 'dice' ? `Dado ${result.diceRoll} · ${result.tokensWonOrLost > 0 ? '+' : ''}${money(result.tokensWonOrLost)} tokens` : game === 'plinko' ? `Multiplicador ${money(result.multiplier)}× · aposta ${money(result.bet)} tokens` : game === 'upgrade' ? result.won ? `Upgrade ganho: ${result.skinName}` : 'Upgrade não ganho' : result.action === 'start' ? 'Vê o vídeo e escolhe a classificação.' : `Rank ${money(result.rank)} · +${money(result.tokensWon)} tokens`)}</span>}</div>}
    {stats && <div className="card-bet-stats">{t("Ganhos +")}{t(money(stats.won))}{t(" · Perdas −")}{t(money(stats.lost))}{t(" tokens")}<br />{t(stats.positive)}{t(" positivas · ")}{t(stats.negative)}{t(" negativas · ")}{t(stats.ties)}{t(" empates")}</div>}
    {(autoActive || autoStoppedReason) && <div className={`game-auto-status ${autoStoppedReason ? 'stopped' : ''}`}><span role="status">{t(autoStoppedReason ? `Automático parado: ${autoStoppedReason}` : `Automático ativo · ${autoDisplay}`)}</span>{autoActive && <button type="button" className="game-stop-account" onClick={()=>onAutoStop(account.id, 'Parado pelo utilizador')} aria-label={t(`Parar automático em ${account.label}`)}><Square size={12} fill="currentColor"/>{t('Parar nesta conta')}</button>}</div>}
    {game==='blackjack'&&<details className="game-table-details"><summary>{t('Detalhes da mesa e do cálculo')}</summary><RulesReadout config={state?.socket?.events?.blackjackConfig}/>
    {game==='blackjack'&&edgeDecision&&<EdgeReadout data={edgeDecision}/>}
    {game==='blackjack'&&<ShoeReadout shoe={shoeTracker.current.snapshot()} stake={nextStake}/>}
    {game==='blackjack'&&autoRun?.mode==='math'&&mathDecision&&<div className="local-ai-decision" role="status"><strong>{t(mathDecision.complete?'Composição finita calculada':'Usada estratégia básica')}</strong><span>{t(mathDecision.complete?`${mathDecision.latencyMs} ms · ${mathDecision.move===mathDecision.reference?'Concorda com a tabela':'Ajuste pela composição observada'}`:({coverage:'Aguarda uma renovação observada do baralho',rules:'Regras recebidas diferem do cliente público',hole:'Carta oculta não confirmada', 'other-seats':'Outros jogadores: cálculo conjunto indisponível',budget:'Cálculo excedeu o orçamento',exhausted:'Composição sem cartas suficientes',worker:'Motor local indisponível',timeout:'Motor excedeu o prazo'})[mathDecision.reason]||'Estado incompleto; mantém a referência')}</span>{mathDecision.complete&&<small>{t("Retorno esperado de todas as tuas mãos por unidade de aposta, hipótese de peek: ")}{t(Object.entries(mathDecision.peek).map(([move,ev])=>`${{hit:'Pedir',stand:'Parar',double:'Dobrar',split:'Dividir'}[move]} ${ev.toFixed(3)}`).join(' · '))}{t(". Só altera a jogada se melhorar também sem peek.")}</small>}</div>}
    {game==='blackjack'&&aiDecision&&<div className="local-ai-decision" role="status">{aiDecision.error?'IA indisponível nesta decisão · usada estratégia básica':<><strong>{t("IA: ")}{t(({hit:'Pedir carta',stand:'Parar',double:'Dobrar',split:'Dividir'})[aiDecision.move])}</strong><span>{t(aiDecision.latencyMs)}{t(" ms · ")}{t(aiDecision.move===aiDecision.reference?'Concorda com a tabela':'Difere da tabela')} · {t(aiDecision.mode==='laya'?'IA selecionada':aiDecision.mode==='hybrid'?`Jogada validada: ${{hit:'Pedir carta',stand:'Parar',double:'Dobrar',split:'Dividir'}[aiDecision.chosen]}`:'Comparação; joga a tabela')}</span>{aiDecision.checked?.ev&&<small>{t("Retorno esperado por token (aproximação): ")}{t(Object.entries(aiDecision.checked.ev.peek).map(([move,value])=>`${{hit:'Pedir',stand:'Parar',double:'Dobrar',split:'Dividir'}[move]} ${value>=0?'+':''}${value.toFixed(3)}`).join(' · '))}<br/>{t("Distribuição padrão S17; sem composição real do baralho. Verificação prévia do Blackjack do dealer não confirmada.")}</small>}</>}</div>}
    </details>}
    {error && <div className="game-error" role="alert">{t(error)}</div>}
  </article>;
}

export default function GamesMosaic({ accounts, onBack, bettingIds = [], setBettingIds = () => {}, stats = { rounds: {}, byAccount: {} }, setStats = () => {}, ui, onUiChange, onAutoStateChange }) {
  const [columns, setColumns] = useGameField(ui,onUiChange,'columns',3);
  const [focusedId, setFocusedId] = useState(null);
  const stageRef = useRef(null);
  const [stageWidth,setStageWidth]=useState(1200);
  const betActions = useRef(new Map());
  const [batchAmount, setBatchAmount] = useGameField(ui,onUiChange,'batchAmount','10');
  const [batchPending, setBatchPending] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [autoRun, setAutoRun] = useState(null);
  const [autoStopped, setAutoStopped] = useState({});
  const [auditRows, setAuditRows] = useState([]);
  const [auditMessage, setAuditMessage] = useState('');
  const [aiMode, setAiMode] = useGameField(ui,onUiChange,'aiMode','math');
  const [progression,setProgression]=useGameField(ui,onUiChange,'progression','edge');
  const [aiReady, setAiReady] = useState(false);
  const autoRunNumber = useRef(0);
  useEffect(()=>{const element=stageRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setStageWidth(entry.contentRect.width));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{onAutoStateChange?.(Boolean(autoRun));},[Boolean(autoRun),onAutoStateChange]);
  useEffect(()=>()=>onAutoStateChange?.(false),[]);
  useEffect(() => {
    if (!window.caseClicker?.onEvent) return undefined;
    let cancelled=false;
    window.caseClicker.blackjackHistory?.().then(rows=>{if(!cancelled)setAuditRows(rows);}).catch(()=>{});
    const unsubscribe=window.caseClicker.onEvent((event) => {
      if(event.type==='blackjack-audit')setAuditRows(previous=>[event.round,...previous.filter(row=>!(row.accountId===event.round.accountId&&row.tableId===event.round.tableId&&row.roundNumber===event.round.roundNumber))].slice(0,400));
      if (event.type === 'socket-game-update' && event.game === 'blackjack' && event.event === 'blackjackTableState') {
        setStats((previous) => addBlackjackResult(previous, event.accountId, event.data));
      }
    });
    return ()=>{cancelled=true;unsubscribe();};
  }, []);
  useEffect(() => { setBettingIds((ids) => ids.filter((id) => accounts.some((account) => account.id === id))); }, [accounts]);
  useEffect(() => { if (autoRun && autoRun.ids.every((id) => autoStopped[id])) setAutoRun(null); }, [autoRun, autoStopped]);
  const registerBet = useCallback((id, action) => { if (action) betActions.current.set(id, action); else betActions.current.delete(id); }, []);
  const onAutoStop = useCallback((id, reason) => setAutoStopped((previous) => ({ ...previous, [id]: reason })), []);
  const [tableIds, setTableIds] = useGameField(ui,onUiChange,'tableIds',null);
  const [tab,setTab] = useGameField(ui,onUiChange,'tab','tables');
  const [query,setQuery] = useState('');
  const [gameFilter,setGameFilter] = useState('all');
  const [managerOpen,setManagerOpen] = useState(false);
  const visible = useMemo(()=>resolveGameTables(accounts,tableIds),[accounts,tableIds]);
  const eligibleIds = useMemo(()=>selectedBlackjackIds(visible,bettingIds,ui?.cards),[visible,bettingIds,ui?.cards]);
  const filtered = useMemo(()=>filterGameTables(visible,query,gameFilter,ui?.cards),[visible,query,gameFilter,ui?.cards]);
  const filteredSet = useMemo(()=>new Set(filtered.map(account=>account.id)),[filtered]);
  const activeCount = autoRun ? autoRun.ids.filter(id=>!autoStopped[id]).length : 0;
  const accountsById=useMemo(()=>accountIndex(accounts),[accounts]);
  const bettingSet=useMemo(()=>new Set(bettingIds),[bettingIds]);
  const totals = useMemo(()=>summarizeBlackjackResults(stats),[stats]);
  const amount = Number(batchAmount);
  const effectiveColumns=gameColumnsForWidth(stageWidth,columns,filtered.length);
  function sectionToggle(key,event){const open=event.currentTarget.open;onUiChange?.(old=>({sections:{...old.sections,[key]:open}}));}
  function updateCard(id,patch){onUiChange?.(old=>({cards:{...old.cards,[id]:{...old.cards?.[id],...patch}}}));}
  async function placeGroupBet() {
    if (progression==='edge' || batchPending || autoRun || !Number.isSafeInteger(amount) || amount < 1 || amount > 5000000 || !eligibleIds.length) return;
    setBatchPending(true); setBatchMessage('');
    try {
      const outcomes = await Promise.all(eligibleIds.map((id) => betActions.current.get(id)?.(amount) ?? { skipped: true }));
      const sent = outcomes.filter((value) => value.sent).length;
      const skipped = outcomes.filter((value) => value.skipped).length;
      const failed = outcomes.length - sent - skipped;
      setBatchMessage(`${sent} pedido(s) enviado(s) · ${skipped} conta(s) sem mesa ou saldo apto · ${failed} falhado(s). Confirma cada aposta no estado da mesa.`);
    } finally { setBatchPending(false); }
  }
  function startAuto() {
    if (autoRun || batchPending || !eligibleIds.length || !Number.isSafeInteger(amount) || amount < 1 || amount > 5000000) return;
    setAutoStopped({}); setBatchMessage('');
    if(!['table','math'].includes(aiMode)&&!aiReady)return;
    setAutoRun({ id: ++autoRunNumber.current, ids: [...eligibleIds], amount, mode:aiMode, progression });
  }
  function selectAccount(id) {
    setBettingIds(ids=>ids.includes(id) ? ids.filter(value=>value!==id) : [...ids,id]);
  }
  function changeTables(ids) {
    if(autoRun || batchPending)return;
    setTableIds(ids);setFocusedId(null);
  }
  return <div className="games-stage games-workspace" ref={stageRef}>
    <GameSessionSummary totals={totals} activeCount={activeCount}/>
    <div className="games-navigation"><div className="games-tabs" role="tablist" aria-label={t('Área de jogos')}>
      {[['tables','Mesas',Grid2X2],['results','Resultados',BarChart3],['advanced','Avançado',Settings2]].map(([id,label,Icon])=><button key={id} type="button" role="tab" id={`games-tab-${id}`} aria-selected={tab===id} aria-controls={`games-panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={event=>{const tabs=['tables','results','advanced'];let next;if(['ArrowRight','ArrowLeft'].includes(event.key)){const step=(event.key==='ArrowRight'?1:-1)*(document.documentElement.dir==='rtl'?-1:1);next=tabs[(tabs.indexOf(tab)+step+3)%3];}else if(event.key==='Home')next=tabs[0];else if(event.key==='End')next=tabs[2];if(next){event.preventDefault();setTab(next);document.getElementById(`games-tab-${next}`)?.focus();}}}><Icon size={16}/>{t(label)}{id==='tables'&&<span>{visible.length}</span>}</button>)}
    </div>{autoRun && tab!=='tables' && <button type="button" className="games-stop-all" onClick={()=>setAutoRun(null)}><Square size={13}/>{t('Parar todas')}</button>}</div>
    <div role="tabpanel" id="games-panel-tables" aria-labelledby="games-tab-tables" hidden={tab!=='tables'}>
      {accounts.length>0 && <GameControlDesk tables={visible} cards={ui?.cards} selectedIds={eligibleIds} onSelectionChange={setBettingIds} amount={batchAmount} setAmount={setBatchAmount} progression={progression} setProgression={setProgression} mode={aiMode} setMode={setAiMode} aiReady={aiReady} running={Boolean(autoRun)} activeCount={activeCount} batchPending={batchPending} onStart={startAuto} onStop={()=>setAutoRun(null)} onBet={placeGroupBet} message={batchMessage} stopped={autoStopped} accountsById={accountsById}/>}
      <div className="games-tables-toolbar"><div><h2>{t('As tuas mesas')}<span>{filtered.length}/{visible.length}</span></h2><small>{t(`${visible.length} de ${accounts.length} contas`)} · {t('até 20 mesas abertas')}</small></div><label className="games-search"><Search size={15}/><input type="search" aria-label={t('Procurar nas mesas')} placeholder={t('Procurar nas mesas…')} value={query} onChange={event=>{setQuery(event.target.value);setFocusedId(null);}}/></label><label className="games-filter"><span className="sr-only">{t('Filtrar por jogo')}</span><select aria-label={t('Filtrar por jogo')} value={gameFilter} onChange={event=>{setGameFilter(event.target.value);setFocusedId(null);}}><option value="all">{t('Todos os jogos')}</option>{games.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label className="games-density"><Grid2X2 size={15}/><select aria-label={t('Máximo de colunas')} value={columns} onChange={event=>setColumns(Number(event.target.value))}>{[1,2,3,4,5].map(number=><option key={number} value={number}>{number} {t(number===1?'coluna':'colunas')}</option>)}</select></label><button type="button" className="games-manage-tables" aria-expanded={managerOpen} disabled={Boolean(autoRun)||batchPending} onClick={()=>setManagerOpen(!managerOpen)}><UsersRound size={15}/>{t('Gerir mesas')}</button></div>
      {managerOpen && <GameTablesManager accounts={accounts} tables={visible} onChange={changeTables} onClose={()=>setManagerOpen(false)} running={Boolean(autoRun)||batchPending}/>}
      {focusedId && <div className="games-focus-bar"><span>{accountsById.get(focusedId)?.label}</span><button type="button" onClick={()=>setFocusedId(null)}><Grid2X2 size={14}/>{t('Ver todas as mesas')}</button></div>}
      <div className="games-grid" style={{'--game-columns':Math.max(1,effectiveColumns)}}>{visible.map((account,index)=><GameCard key={account.id} ui={ui?.cards?.[account.id]} onUiChange={patch=>updateCard(account.id,patch)} account={account} index={index} hidden={!filteredSet.has(account.id)||Boolean(focusedId&&focusedId!==account.id)} selected={bettingSet.has(account.id)} onSelectedChange={()=>selectAccount(account.id)} selectionLocked={Boolean(autoRun)||batchPending} focused={focusedId===account.id} onFocus={()=>setFocusedId(id=>id===account.id?null:account.id)} registerBet={registerBet} stats={stats.byAccount[account.id]} autoRun={autoRun} autoStoppedReason={autoStopped[account.id]} onAutoStop={onAutoStop}/>)}</div>
      {!filtered.length && <div className="games-empty-state"><Gamepad2 size={30}/><h3>{t(!accounts.length?'As tuas mesas começam aqui':!visible.length?'Escolhe as contas para abrir mesas':'Nenhuma mesa corresponde aos filtros')}</h3><p>{t(!accounts.length?'Adiciona contas para acompanhar e jogar em mesas independentes.':!visible.length?'Abre Gerir mesas e escolhe até 20 contas.':'Experimenta outro nome ou outro jogo.')}</p>{!accounts.length ? <button type="button" onClick={onBack}><ArrowLeft size={15}/>{t('Voltar ao dashboard')}</button> : visible.length ? <button type="button" onClick={()=>{setQuery('');setGameFilter('all');}}>{t('Limpar filtros')}</button> : <button type="button" onClick={()=>setManagerOpen(true)}>{t('Gerir mesas')}</button>}</div>}
    </div>
    <div role="tabpanel" id="games-panel-results" aria-labelledby="games-tab-results" hidden={tab!=='results'}>
      <GameAccountResults accounts={accounts} stats={stats}/>
      <details className="advanced-section"><summary>{t('Histórico de Blackjack')}<span>{t('Resultados e decisões por mão')}</span></summary><div><BlackjackHistory rows={auditRows} accounts={accounts} onExport={async()=>{try{const file=await window.caseClicker.exportRun();if(file)setAuditMessage(`Análise guardada em ${file}`);}catch(error){setAuditMessage(error.message);}}}/>{auditMessage&&<p role="status">{t(auditMessage)}</p>}</div></details>
    </div>
    <div role="tabpanel" id="games-panel-advanced" aria-labelledby="games-tab-advanced" hidden={tab!=='advanced'}>
      <div className="games-advanced-intro"><Settings2 size={18}/><div><h2>{t('Estratégia e ferramentas locais')}</h2><p>{t('Configura o motor e consulta a evidência experimental.')}</p></div></div>
      <details className="advanced-section" open={ui?.sections?.engine===true} onToggle={event=>sectionToggle('engine',event)}><summary>{t('Motor e IA local')}<span>{t('Configuração avançada')}</span></summary><div><FiniteSelfCheck running={Boolean(autoRun)}/><LocalAiPanel mode={aiMode} setMode={setAiMode} running={Boolean(autoRun)} onReady={setAiReady}/></div></details>
      <details className="advanced-section" open={ui?.sections?.research===true} onToggle={event=>sectionToggle('research',event)}><summary>{t('Investigação')}<span>{t('Simulações e evidência experimental')}</span></summary><div><SimulationReadout/><EngineCoverage rows={auditRows}/><PayoutReview rows={auditRows}/></div></details>
    </div>
  </div>;
}
