import React, {useState} from 'react';
import {ArrowDownLeft, ArrowUpRight, ChevronDown, CircleHelp, Coins, Gamepad2, Play, Search, Square, UsersRound, X} from 'lucide-react';
import {t, getLocale} from '../language.js';
import {ProgressionControl} from '../BlackjackResearchPanel.jsx';
import {filterGameTables, MAX_GAME_TABLES} from '../gameWorkspace.js';

const number = value => Number(value).toLocaleString(getLocale(), {maximumFractionDigits: 2});

export function GameSessionSummary({totals, activeCount}) {
  return <section className="games-session" aria-label={t('Resumo da sessão')}>
    <div className="games-session-label"><span className={`games-live-dot ${activeCount ? 'active' : ''}`} /><span>{t('Esta sessão')}<small>{t(activeCount ? `${activeCount} contas em automático` : 'Automático parado')}</small></span></div>
    <dl>
      <div className="session-net"><dt>{t('Resultado líquido')}</dt><dd className={totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : ''}>{totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}{number(Math.abs(totals.net))}<small>{t('tokens')}</small></dd></div>
      <div><dt><ArrowUpRight size={14}/>{t('Ganhos')}</dt><dd>{number(totals.won)}</dd></div>
      <div><dt><ArrowDownLeft size={14}/>{t('Perdas')}</dt><dd>{number(totals.lost)}</dd></div>
      <div><dt>{t('Rondas confirmadas')}</dt><dd>{number(totals.positive + totals.negative + totals.ties)}</dd></div>
    </dl>
  </section>;
}

export function GameControlDesk({tables, cards, selectedIds, onSelectionChange, amount, setAmount, progression, setProgression, mode, setMode, aiReady, running, activeCount, batchPending, onStart, onStop, onBet, message, stopped, accountsById}) {
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const choices = tables.filter(account => (cards?.[account.id]?.game || 'blackjack') === 'blackjack');
  const filtered = filterGameTables(choices, query, 'all');
  const selected = new Set(selectedIds);
  const validAmount = Number.isSafeInteger(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 5000000;
  const validSelection = !batchPending && validAmount && selectedIds.length > 0;
  const validStart = validSelection && (['table','math'].includes(mode) || aiReady);
  return <section className="games-control-desk" aria-labelledby="games-control-title">
    <header><div className="games-section-title"><span className="games-section-icon"><Gamepad2 size={19}/></span><div><h2 id="games-control-title">{t('Blackjack em grupo')}</h2><p>{t('Uma configuração, mesas independentes.')}</p></div></div><button type="button" className="games-pick-trigger" aria-expanded={pickerOpen} aria-controls="games-bet-picker" disabled={running || batchPending} onClick={() => setPickerOpen(!pickerOpen)}><UsersRound size={16}/>{selectedIds.length} {t('selecionadas')}<ChevronDown size={14}/></button></header>
    {pickerOpen && <div id="games-bet-picker" className="games-bet-picker">
      <div className="games-picker-tools"><label className="games-search"><Search size={15}/><input type="search" aria-label={t('Procurar conta para apostar')} placeholder={t('Procurar conta…')} value={query} onChange={event=>setQuery(event.target.value)}/></label><button type="button" disabled={running || batchPending || !filtered.length} onClick={()=>onSelectionChange([...new Set([...selectedIds, ...filtered.map(a=>a.id)])])}>{t('Selecionar visíveis')}</button><button type="button" disabled={running || batchPending || !selectedIds.length} onClick={()=>onSelectionChange([])}>{t('Limpar seleção')}</button></div>
      <div className="games-account-choices">{filtered.map(account=><label key={account.id} className={selected.has(account.id) ? 'selected' : ''}><input type="checkbox" disabled={running || batchPending} checked={selected.has(account.id)} onChange={()=>onSelectionChange(selected.has(account.id) ? selectedIds.filter(id=>id!==account.id) : [...selectedIds, account.id])}/><span>{account.label}</span></label>)}</div>
      {!filtered.length && <p className="games-inline-empty">{t('Nenhuma conta Blackjack corresponde à pesquisa.')}</p>}
      <small>{t('Só inclui contas com Blackjack aberto. A seleção da automação é independente.')}</small>
    </div>}
    <div className="games-config-fields"><label>{t(progression === 'edge' ? 'Teto por ronda (tokens)' : 'Aposta por conta (tokens)')}<div className="games-amount-input"><Coins size={16}/><input type="number" min="1" max="5000000" step="1" value={amount} disabled={running || batchPending} onChange={event=>setAmount(event.target.value)}/></div></label><ProgressionControl value={progression} onChange={setProgression} running={running || batchPending}/><label>{t('Estratégia')}<select aria-label={t("Estratégia")} value={mode} disabled={running || batchPending} onChange={event=>setMode(event.target.value)}><option value="table">{t('Tabela básica')}</option><option value="math">{t('Composição do baralho · experimental')}</option><option value="hybrid">{t('IA com validação')}</option><option value="laya">{t('IA local · experimental')}</option><option value="compare">{t('Comparar IA · joga a tabela')}</option></select></label></div>
    <footer><p role="status">{running ? <><span className="games-live-dot active"/>{t(`${activeCount} contas em automático`)}</> : !selectedIds.length ? t('Seleciona contas nos cartões ou na lista acima.') : !validAmount ? t('Introduz um valor inteiro entre 1 e 5 000 000 tokens.') : !['table','math'].includes(mode) && !aiReady ? t('Prepara a IA local nas opções avançadas.') : t('Pronto para iniciar nas contas selecionadas.')}</p><div className="games-launch-actions">{progression !== 'edge' && <button type="button" className="games-manual-bet" disabled={running || !validSelection} onClick={onBet}>{t(batchPending ? 'A enviar…' : 'Apostar uma ronda')}</button>}{running ? <button type="button" className="games-stop-all" onClick={onStop}><Square size={14} fill="currentColor"/>{t('Parar todas')}</button> : <button type="button" className="games-start-all" disabled={!validStart} onClick={onStart}><Play size={15} fill="currentColor"/>{t('Iniciar automático')}</button>}</div></footer>
    {message && <p className="games-feedback" role="status">{t(message)}</p>}
    {Object.keys(stopped).length > 0 && <details className="games-stopped"><summary>{t('Contas paradas')} · {Object.keys(stopped).length}</summary>{Object.entries(stopped).map(([id, reason])=><p key={id}><strong>{accountsById.get(id)?.label || id}</strong> · {t(reason)}</p>)}</details>}
    <details className="games-control-note"><summary><CircleHelp size={13}/>{t('Como funciona a aposta e a paragem')}</summary><p>{t(progression==='edge'?'Simulação local antes da aposta. Usa uma fração conservadora do saldo, dentro do teto e com espaço para até quatro mãos duplicadas. As hipóteses do baralho continuam por confirmar.':progression==='fixed'?'O valor escolhido mantém-se em todas as rondas, dentro dos limites da mesa.':'Empate mantém. Metades arredondadas para baixo; respeita o mínimo e máximo da mesa. Cada conta tem a sua progressão.')}</p><p>{t('A progressão altera o valor apostado; não melhora as probabilidades nem garante lucro. Parar impede novos pedidos; um pedido já enviado pode concluir.')}</p></details>
  </section>;
}

export function GameTablesManager({accounts, tables, onChange, onClose, running}) {
  const [query, setQuery] = useState('');
  const ids = tables.map(a=>a.id), selected = new Set(ids);
  const filtered = filterGameTables(accounts, query, 'all');
  return <section className="games-tables-manager" aria-labelledby="games-manager-title">
    <header><div><h3 id="games-manager-title">{t('Contas nas mesas')}</h3><p>{t('Escolhe até 20 contas de toda a tua lista. Abrir uma mesa não inicia apostas.')}</p></div><button type="button" className="games-icon-button" aria-label={t('Fechar seleção de mesas')} onClick={onClose}><X size={18}/></button></header>
    <div className="games-picker-tools"><label className="games-search"><Search size={15}/><input type="search" aria-label={t('Procurar conta para abrir mesa')} placeholder={t('Procurar em todas as contas…')} value={query} onChange={event=>setQuery(event.target.value)}/></label><span>{tables.length}/{MAX_GAME_TABLES} {t('mesas abertas')}</span><button type="button" disabled={running || !tables.length} onClick={()=>onChange([])}>{t('Limpar mesas')}</button></div>
    <div className="games-account-choices">{filtered.map(account=><label key={account.id} className={selected.has(account.id) ? 'selected' : ''}><input type="checkbox" checked={selected.has(account.id)} disabled={running || !selected.has(account.id) && tables.length >= MAX_GAME_TABLES} onChange={()=>onChange(selected.has(account.id) ? ids.filter(id=>id!==account.id) : [...ids,account.id])}/><span>{account.label}</span></label>)}</div>
    {!filtered.length && <p className="games-inline-empty">{t('Nenhuma conta corresponde à pesquisa.')}</p>}
  </section>;
}

export function GameAccountResults({accounts, stats}) {
  return <section className="games-account-report"><header><h2>{t('Resultados por conta')}</h2><p>{t('Apenas rondas confirmadas nesta sessão.')}</p></header><div className="games-results-scroll"><table><thead><tr><th>{t('Conta')}</th><th>{t('Ganhos')}</th><th>{t('Perdas')}</th><th>{t('Resultado líquido')}</th><th>{t('Rondas')}</th></tr></thead><tbody>{accounts.map(account=>{const row=stats.byAccount[account.id] || {won:0,lost:0,positive:0,negative:0,ties:0}, net=row.won-row.lost;return <tr key={account.id}><th scope="row">{account.label}</th><td>{number(row.won)}</td><td>{number(row.lost)}</td><td className={net>0?'positive':net<0?'negative':''}>{net>0?'+':''}{number(net)}</td><td>{row.positive+row.negative+row.ties}</td></tr>;})}</tbody></table></div></section>;
}
