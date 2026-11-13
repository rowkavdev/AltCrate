import {t,getLocale} from './language.js';
import React from 'react';

const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', H: '♥', D: '♦', C: '♣', S: '♠' };
const formatProfit = (value) => Math.abs(value).toLocaleString(getLocale(), { maximumFractionDigits: 2 });

function seatOutcome(seat) {
  if (Number.isFinite(seat.netProfit)) return seat.netProfit > 0 ? `${seat.mine ? 'Ganhaste' : 'Ganhou'} +${formatProfit(seat.netProfit)}` : seat.netProfit < 0 ? `Perdeu ${formatProfit(seat.netProfit)}` : 'Empate';
  const results = seat.hands?.map((hand) => hand.result).filter(Boolean) || [];
  if (!results.length) return 'A apurar';
  if (results.every((result) => result === 'push')) return 'Empate';
  if (results.every((result) => result === 'win' || result === 'blackjack')) return seat.mine ? 'Ganhaste' : 'Ganhou';
  if (results.every((result) => result === 'lose')) return 'Perdeu';
  return 'Resultado misto';
}

export function PlayingCard({ card, hidden = false }) {
  const symbol = symbols[card?.suit] || symbols[String(card?.suit || '').toLowerCase()] || '♠';
  const red = symbol === '♥' || symbol === '♦';
  return <span className={`playing-card ${hidden ? 'card-back' : ''} ${red ? 'card-red' : ''}`} aria-label={t(hidden ? 'Carta oculta' : card?.rank ? `${card.rank} ${symbol}` : 'Carta por revelar')}>
    {hidden ? <span className="card-back-mark">◆</span> : card?.rank ? <><b>{t(card.rank)}<small>{t(symbol)}</small></b><strong>{t(symbol)}</strong><b>{t(card.rank)}<small>{t(symbol)}</small></b></> : <span className="card-unknown">?</span>}
  </span>;
}

export function GameVisual({ game, socket, result, target, choice, risk }) {
  const events = socket?.events || {};
  if (game === 'blackjack') {
    const table = events.blackjackTableState;
    const seats = table?.seats || [];
    const mySeatIndex = events.blackjackMySeat?.tableId === table?.tableId ? events.blackjackMySeat?.seatIndex : null;
    const ownSeat = seats.find((seat) => seat?.mine) || (Number.isInteger(mySeatIndex) ? seats[mySeatIndex] : null);
    const dealer = table?.dealerCards || [];
    const hands = ownSeat?.hands || [];
    return <div className="game-visual blackjack-visual">
      <div className="felt-rim"><div className="felt-table">
        <div className="table-top"><span>{t("CASE CLICKER")}</span><span className="table-phase">{t(table?.roundNumber ? `Ronda ${table.roundNumber} · ` : '')}{t(table?.phase || 'MESA PRIVADA')}</span></div>
        <div className="dealer-zone"><small>{t("DEALER")}{t(table?.dealerValue != null ? ` · ${table.dealerValue}` : '')}</small><div className="card-fan">{dealer.map((card, index) => <PlayingCard key={index} card={card} />)}{table?.dealerHoleCardHidden && <PlayingCard hidden />}{!dealer.length && !table?.dealerHoleCardHidden && <span className="cards-waiting">{t("À espera das cartas")}</span>}</div></div>
        {table?.phase === 'result' && seats.some((seat) => seat?.hands?.length) ? <div className="blackjack-results">{seats.filter((seat) => seat?.hands?.length).map((seat, index) => <span key={seat.index ?? index} className={seat.netProfit > 0 ? 'won' : seat.netProfit < 0 ? 'lost' : ''}><b>{t(seat.mine ? 'Tu' : seat.name || `Lugar ${(seat.index ?? index) + 1}`)}</b> · {t(seatOutcome(seat))}</span>)}</div> : <div className="table-rule">{t("BLACKJACK PAYS 3 TO 2")}</div>}
        <div className="player-zone"><div className="blackjack-hands">{hands.length ? hands.map((hand, handIndex) => <div key={handIndex} className={`blackjack-hand ${handIndex === ownSeat.activeHandIndex ? 'active' : ''}`}><div className="card-fan">{hand.cards.map((card, index) => <PlayingCard key={index} card={card} />)}</div><small>{t("MÃO ")}{t(handIndex + 1)}{t(hand.value != null ? ` · ${hand.value}` : '')} · {t(hand.status)}</small></div>) : <span className="cards-waiting">{t(ownSeat ? 'À espera da próxima ronda' : 'Escolhe um lugar')}</span>}</div></div>
        <div className="seat-dots">{Array.from({ length: Math.min(10, table?.maxSeats || 5) }, (_, index) => <span key={index} className={`${seats[index] ? 'occupied' : ''} ${seats[index]?.mine || mySeatIndex === index ? 'mine' : ''}`}>{t(index + 1)}</span>)}</div>
      </div></div>
    </div>;
  }
  if (game === 'crash') {
    const multiplier = events.crashTick?.multiplier ?? events.crashState?.multiplier;
    return <div className="game-visual crash-visual"><div className="crash-grid"><div className="crash-readout"><small>{t("MULTIPLICADOR ATUAL")}</small><strong>{t(Number.isFinite(multiplier) ? `${multiplier.toFixed(2)}×` : '—')}</strong><span>{t(socket?.phase || 'À espera da ronda')}</span></div></div></div>;
  }
  if (game === 'dice') return <div className="game-visual dice-visual"><div className="dice-cube"><span>?</span></div><div><small>{t(choice === 'over' ? 'ACIMA DE' : 'ABAIXO DE')}</small><strong>{t(target || '—')}</strong><p>{t(result?.verified ? `Resultado do servidor: ${result.diceRoll}` : 'Resultado por revelar')}</p></div></div>;
  if (game === 'plinko') return <div className="game-visual plinko-visual"><div className="plinko-board">{Array.from({ length: 7 }, (_, row) => <div key={row}>{Array.from({ length: row + 3 }, (_, col) => <i key={col} />)}</div>)}</div><div className="plinko-slots"><span>{t("0.2×")}</span><span>{t("1×")}</span><span>{t("2×")}</span><span>{t("5×")}</span><span>{t("10×")}</span></div><small>{t("RISCO ")}{t(risk?.toUpperCase())}</small></div>;
  if (game === 'coinflip') return <div className="game-visual coinflip-visual"><div className="coin coin-heads">{t("H")}</div><span>{t("VS")}</span><div className="coin coin-tails">{t("T")}</div><small>{t("PARTIDAS EM DIRETO")}</small></div>;
  if (game === 'jackpot') return <div className="game-visual jackpot-visual"><div className="jackpot-ring"><span>◆</span></div><div><small>{t("POTE PRIVADO")}</small><strong>{t("JACKPOT")}</strong><p>{t("O resultado é decidido pelo servidor")}</p></div></div>;
  if (game === 'casebattle') return <div className="game-visual battle-visual"><div className="battle-case"><span>✦</span></div><b>{t("VS")}</b><div className="battle-case"><span>✦</span></div><small>{t("CASEBATTLE")}</small></div>;
  if (game === 'upgrade') return <div className="game-visual upgrade-visual"><div className="upgrade-orbit"><span>◆</span></div><div><small>{t("ITEM ALVO")}</small><strong>{t(result?.verified && result?.won ? 'CONSEGUIDO' : 'UPGRADE')}</strong><p>{t("Escolhe um item antes de tentar")}</p></div></div>;
  return <div className="game-visual rank-visual"><div className="rank-medal">★</div><div><small>{t("VÍDEO DA RONDA")}</small><strong>{t("ADIVINHA O RANK")}</strong><p>{t("Vê o clip e escolhe a classificação")}</p></div></div>;
}
