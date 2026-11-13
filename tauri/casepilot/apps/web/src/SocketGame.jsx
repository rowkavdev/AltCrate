import {t,getLocale} from './language.js';
import React, { useEffect, useState } from 'react';
import {useGameField} from './useGameField.js';
import { blackjackAdvice, blackjackCardValue } from './blackjackAuto.js';

const format = (value) => Number.isFinite(value) ? value.toLocaleString(getLocale(), { maximumFractionDigits: 2 }) : '—';

function RemainingTime({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!Number.isFinite(until)) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [until]);
  if (!Number.isFinite(until)) return null;
  return <span className="blackjack-timer">{t("Tempo restante: ")}{t(Math.max(0, Math.ceil((until - now) / 1000)))}{t("s")}</span>;
}

function BlackjackControls({ events, connected, pending, bet, setBet, validBet, action, autoActive, ui, onUiChange }) {
  const [code,setCode]=useGameField(ui,onUiChange,'code','');
  const table = events.blackjackTableState;
  const joined = events.blackjackTableJoined;
  const tableId = table?.tableId || joined?.tableId || events.blackjackMySeat?.tableId;
  const tableCode = table?.code || (tableId && joined?.tableId === tableId ? joined?.code : null) || (tableId && events.blackjackMySeat?.tableId === tableId ? events.blackjackMySeat?.code : null);
  const seatIndex = tableId && events.blackjackMySeat?.tableId === tableId ? events.blackjackMySeat?.seatIndex : null;
  const ownSeat = table?.seats?.find((seat) => seat?.mine) || (Number.isInteger(seatIndex) ? table?.seats?.[seatIndex] : null);
  const seats = table?.seats || [];
  const minBet = table?.minBet ?? events.blackjackConfig?.minBet ?? 1;
  const maxBet = Math.min(table?.maxBet ?? events.blackjackConfig?.maxBet ?? 5000000, 5000000);
  const canBet = connected && !pending && !autoActive && ownSeat?.status === 'betting' && table?.phase === 'betting' && validBet && Number(bet) >= minBet && Number(bet) <= maxBet;
  const activeHand = Number.isInteger(ownSeat?.activeHandIndex) ? ownSeat.hands?.[ownSeat.activeHandIndex] : null;
  const isTurn = connected && !pending && table?.phase === 'acting' && ownSeat?.turnId != null && activeHand?.status === 'playing';
  const canDouble = isTurn && activeHand.cards.length === 2 && !activeHand.splitAces;
  const canSplit = isTurn && activeHand.cards.length === 2 && ownSeat.hands.length < 4 && !activeHand.splitAces &&
    (activeHand.cards[0].rank === activeHand.cards[1].rank || (blackjackCardValue(activeHand.cards[0]) === 10 && blackjackCardValue(activeHand.cards[1]) === 10));
  const moves = [['hit', 'Pedir carta', isTurn], ['stand', 'Parar', isTurn], ['double', 'Dobrar', canDouble], ['split', 'Dividir', canSplit]];

  return <>
    {!tableId && <div className="blackjack-entry">
      <button type="button" className="primary-button" disabled={!connected || pending || autoActive || Boolean(tableId)} onClick={() => action('create')}>{t("Abrir mesa privada")}</button>
      <label>{t("Código da mesa")}<input value={code} onChange={(event) => setCode(event.target.value.trim().toUpperCase())} maxLength={80} placeholder={t(tableCode || 'Código de convite')} /></label>
      <button type="button" className="game-secondary" disabled={!connected || pending || autoActive || Boolean(tableId) || code.length < 4} onClick={() => action('join', { code })}>{t("Entrar")}</button>
    </div>}
    {tableId && <>
      <div className="socket-stat"><strong>{t("Mesa ")}{t(tableId.slice(0, 8))}</strong><small>{t(table?.phase || 'A aguardar mesa')} · {t(seats.filter(Boolean).length)}{t(" lugares ocupados")}{t(tableCode ? ` · código ${tableCode}` : '')}</small></div>
      {!ownSeat && <>
        <div className="socket-seats">{Array.from({ length: Math.min(10, table?.maxSeats || 5) }, (_, index) => <button type="button" key={index} disabled={!connected || pending || autoActive || !tableCode || Boolean(seats[index])} onClick={() => action('sit', { tableId, code: tableCode, seatIndex: index })}>{t("Lugar ")}{t(index + 1)}</button>)}</div>
        {!tableCode && <small className="game-cost">{t("À espera do código da mesa privada enviado pelo servidor.")}</small>}
      </>}
      <div className="blackjack-bet-panel">
        <label>{t("Aposta em tokens")}<input type="number" min={minBet} max={maxBet} step="1" value={bet} disabled={autoActive} onChange={(event) => setBet(event.target.value)} /></label>
        <button type="button" className="primary-button" disabled={!canBet} onClick={() => action('bet', { bet: Number(bet) })}>{t("Apostar ")}{t(format(Number(bet)))}{t(" tokens")}</button>
        <small>{t("Limites da mesa: ")}{t(format(minBet))}–{t(format(maxBet))}{t(" tokens · ")}{t(ownSeat ? `Lugar ${ownSeat.index + 1} · ${ownSeat.status || 'à espera'}` : 'Escolhe um lugar')}</small>
      </div>
      {ownSeat?.hands?.length > 0 && <div className="socket-hand">{ownSeat.hands.map((hand, index) => <span key={index} className={index === ownSeat.activeHandIndex ? 'active' : ''}>{t("Mão ")}{t(index + 1)}: {t(hand.cards.map((card) => `${card.rank}${card.suit}`).join(' ') || '—')}{t(hand.value != null ? ` · ${hand.value}` : '')} · {t(hand.status)}</span>)}</div>}
      {ownSeat && <div className="blackjack-turn-panel"><div className="blackjack-turn-status"><small>{t(isTurn ? `A tua vez · mão ${ownSeat.activeHandIndex + 1}` : ownSeat.status === 'bet' ? 'Aposta confirmada; aguarda as cartas.' : table?.phase === 'acting' ? 'A aguardar a tua vez.' : table?.phase === 'dealer' ? 'O dealer está a jogar.' : table?.phase === 'result' ? 'Ronda terminada.' : 'À espera da próxima ronda.')}</small><RemainingTime until={isTurn ? ownSeat.actionDeadlineAt ?? table?.deadlineAt : table?.phase === 'betting' ? table?.deadlineAt : null} /></div>{isTurn && blackjackAdvice(activeHand, table?.dealerCards?.[0], canDouble, canSplit) && <small className="blackjack-advice">{t("Dica: ")}{t(blackjackAdvice(activeHand, table?.dealerCards?.[0], canDouble, canSplit))}{t(" · estratégia básica, sem garantia")}</small>}<div className="socket-seats">{moves.map(([move, label, enabled]) => <button type="button" key={move} disabled={!enabled || autoActive} onClick={() => action('play', { move, turnId: ownSeat.turnId })}>{t(label)}</button>)}</div></div>}
    </>}
    {!tableId && <div className="socket-lobby"><strong>{t((events.blackjackLobby?.games || []).length)}{t(" mesas no lobby")}</strong></div>}
  </>;
}

export default function SocketGame({ game, socket, bet, setBet, validBet, pending, act, autoActive = false, ui, onUiChange }) {
  const [autoCashout, setAutoCashout] = useGameField(ui,onUiChange,'autoCashout','');
  const [jackpotTime, setJackpotTime] = useGameField(ui,onUiChange,'jackpotTime','30');
  const [jackpotMax, setJackpotMax] = useGameField(ui,onUiChange,'jackpotMax','1000');
  const events = socket?.events || {};
  const lobby = events.games?.games || events.gamesJackpot?.games || events.blackjackLobby?.games || [];
  const crash = events.crashState || {};
  const crashPhase = socket?.phase || crash.phase;
  const crashMultiplier = events.crashTick?.multiplier ?? crash.multiplier;
  const connected = socket?.connected;
  const action = (name, payload = {}) => act(name, payload);
  return <div className="game-controls socket-controls">
    <div className={`socket-state ${connected ? 'online' : ''}`}>{t(connected ? 'Ligado ao servidor de jogo' : socket?.paused ? 'Ligação pausada' : 'A ligar ao servidor de jogo…')}</div>
    {game === 'crash' && <><div className="socket-stat"><strong>{t(format(crashMultiplier))}{t("×")}</strong><small>{t("Ronda: ")}{t(crashPhase || 'a aguardar')} · {t(crash.bets ?? 0)}{t(" apostas")}</small></div><label>{t("Aposta em tokens")}<input type="number" min="1" step="1" value={bet} onChange={(event) => setBet(event.target.value)} /></label><label>{t("Cashout automático (opcional)")}<input type="number" min="1.01" max="1000" step="0.01" value={autoCashout} onChange={(event) => setAutoCashout(event.target.value)} placeholder={t("Ex.: 2.00")} /></label><button type="button" className="primary-button" disabled={!connected || !validBet || pending || crashPhase !== 'betting' || crash.isLocked} onClick={() => action('bet', { bet: Number(bet), autoCashout: autoCashout || null })}>{t("Apostar ")}{t(format(Number(bet)))}{t(" tokens")}</button><button type="button" className="game-secondary" disabled={!connected || pending || crashPhase !== 'running'} onClick={() => action('cashout')}>{t("Levantar aposta agora")}</button></>}
    {game === 'coinflip' && <div className="game-unavailable"><strong>{t("Lobby em tempo real")}</strong><p>{t("A API observada cria partidas públicas, que podem envolver contas de terceiros. A aposta fica desativada nesta auditoria de uma conta de teste.")}</p></div>}
    {game === 'jackpot' && <><div className="game-controls-row"><label>{t("Duração (s)")}<input type="number" min="10" max="300" step="1" value={jackpotTime} onChange={(event) => setJackpotTime(event.target.value)} /></label><label>{t("Depósito máximo")}<input type="number" min="1" max="10000000" step="1" value={jackpotMax} onChange={(event) => setJackpotMax(event.target.value)} /></label></div><button type="button" className="primary-button" disabled={!connected || pending || !Number.isSafeInteger(Number(jackpotTime)) || !Number.isSafeInteger(Number(jackpotMax))} onClick={() => action('create', { time: Number(jackpotTime), maxDeposit: Number(jackpotMax), isPrivate: true })}>{t("Criar Jackpot privado")}</button><small className="game-cost">{t("A criação pode exigir uma subscrição. Depositar itens ainda não está disponível.")}</small></>}
    {game === 'blackjack' && <BlackjackControls ui={ui} onUiChange={onUiChange} events={events} connected={connected} pending={pending} bet={bet} setBet={setBet} validBet={validBet} action={action} autoActive={autoActive} />}
    {game === 'casebattle' && <div className="game-unavailable"><strong>{t("Partidas visíveis")}</strong><p>{t("A criação de Casebattle exige selecionar casos e regras adicionais. Esta versão mostra as partidas; não envia uma configuração incompleta.")}</p></div>}
    {['coinflip', 'jackpot', 'casebattle'].includes(game) && <div className="socket-lobby"><strong>{t(lobby.length)}{t(" partidas no lobby")}</strong>{lobby.slice(0, 8).map((row) => <div key={row.id}><span>#{t(row.id.slice(0, 8))} · {t(row.status || 'aberta')}</span><span>{t(row.bet !== null ? `${format(row.bet)} tokens` : row.price !== null ? `$${format(row.price)}` : '')}</span></div>)}</div>}
    {Object.entries(events).filter(([, value]) => value?.error).slice(-1).map(([key, value]) => <div key={key} className="game-error" role="alert">{t(value.error)}</div>)}
  </div>;
}
