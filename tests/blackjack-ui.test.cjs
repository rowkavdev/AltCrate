const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const basicProps = { game: 'blackjack', bet: '2', setBet: () => {}, validBet: true, pending: false, act: () => {} };

async function loadComponents() {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: SocketGame } = await server.ssrLoadModule('/src/SocketGame.jsx');
    const { GameVisual } = await server.ssrLoadModule('/src/GameVisual.jsx');
    return { SocketGame, GameVisual };
  } finally { await server.close(); }
}

test('Blackjack renders safely while no table has been joined', async () => {
  const { SocketGame } = await loadComponents();
  const html = render(SocketGame, { ...basicProps, socket: { connected: true, events: {} } });
  assert.match(html, /Abrir mesa privada/);
  assert.match(html, /Código da mesa/);
});

test('Blackjack renders a private seat, bet and server cards', async () => {
  const { SocketGame, GameVisual } = await loadComponents();
  const events = {
    blackjackTableJoined: { tableId: 'table123', code: '3D76SA' },
    blackjackTableState: {
      tableId: 'table123', phase: 'acting', minBet: 1, maxBet: 100, dealerCards: [{ rank: '10', suit: 'H' }], dealerHoleCardHidden: true,
      seats: [{ index: 0, mine: true, status: 'playing', turnId: 'turn123', activeHandIndex: 0, hands: [{ status: 'playing', value: 16, cards: [{ rank: '8', suit: 'D' }, { rank: '8', suit: 'S' }] }] }],
    },
  };
  const controls = render(SocketGame, { ...basicProps, socket: { connected: true, events } });
  const visual = render(GameVisual, { game: 'blackjack', socket: { events } });
  assert.match(controls, /A tua vez/);
  assert.match(controls, /Pedir carta/);
  assert.match(controls, /Dividir/);
  assert.match(visual, /10 ♥/);
  assert.match(visual, /Carta oculta/);
  assert.match(visual, /8 ♦/);
});

test('Blackjack displays winners and losers from the server result', async () => {
  const { GameVisual } = await loadComponents();
  const events = { blackjackTableState: {
    tableId: 'table123', phase: 'result', roundNumber: 4, dealerCards: [{ rank: '10', suit: 'H' }, { rank: '8', suit: 'S' }], dealerValue: 18,
    seats: [
      { index: 0, mine: true, name: 'Owner', netProfit: 15, hands: [{ status: 'blackjack', result: 'blackjack', value: 21, cards: [{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }] }] },
      { index: 1, mine: false, name: 'Guest', netProfit: -10, hands: [{ status: 'bust', result: 'lose', value: 23, cards: [{ rank: '10', suit: 'C' }, { rank: '6', suit: 'D' }, { rank: '7', suit: 'H' }] }] },
    ],
  } };
  const visual = render(GameVisual, { game: 'blackjack', socket: { events } });
  assert.match(visual, /Ronda 4/);
  assert.match(visual, /Ganhaste/);
  assert.match(visual, /Guest/);
  assert.match(visual, /Perdeu/);
});

test('Blackjack shows remaining time and a card-based move suggestion during the account turn', async () => {
  const { SocketGame } = await loadComponents();
  const events = { blackjackTableState: {
    tableId: 'table123', phase: 'acting', deadlineAt: Date.now() + 12000, dealerCards: [{ rank: '10', suit: 'H' }],
    seats: [{ index: 0, mine: true, status: 'playing', turnId: 'turn123', activeHandIndex: 0, actionDeadlineAt: Date.now() + 8000,
      hands: [{ status: 'playing', cards: [{ rank: '10', suit: 'C' }, { rank: '6', suit: 'D' }], value: 16 }] }],
  } };
  const controls = render(SocketGame, { ...basicProps, socket: { connected: true, events } });
  assert.match(controls, /Tempo restante/);
  assert.match(controls, /Dica: Pedir carta/);
});

test('manual Blackjack move is disabled while automation owns the account', async () => {
  const { SocketGame } = await loadComponents();
  const events = { blackjackTableState: {
    tableId: 'table123', phase: 'acting', dealerCards: [{ rank: '10', suit: 'H' }],
    seats: [{ index: 0, mine: true, status: 'playing', turnId: 'turn123', activeHandIndex: 0,
      hands: [{ status: 'playing', cards: [{ rank: '10', suit: 'C' }, { rank: '6', suit: 'D' }], value: 16 }] }],
  } };
  const html = render(SocketGame, { ...basicProps, autoActive: true, socket: { connected: true, events } });
  assert.match(html, /Dica: Pedir carta/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Pedir carta<\/button>/);
});

test('games mosaic has independent betting account selection and result totals', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: GamesMosaic } = await server.ssrLoadModule('/src/GamesMosaic.jsx');
    const html = render(GamesMosaic, { accounts: [{ id: 'one', label: 'Teste A' }, { id: 'two', label: 'Teste B' }], onBack: () => {} });
    assert.match(html, /Contas para apostar/);
    assert.match(html, /Aposta calculada pelo automático/);
    assert.match(html,/Teto automático por ronda/);
    assert.match(html,/value="edge" selected=""/);
    assert.match(html, /Iniciar automático/);
    assert.match(html, /Ganhos/);
    assert.match(html, /Perdas/);
    assert.match(html, /Teste A/);
    assert.match(html, /Teste B/);
  } finally { await server.close(); }
});

test('hand analysis distinguishes correct losing plays, insufficient funds and actual deviations',async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try {
    const {default:History,analyzeDecision}=await server.ssrLoadModule('/src/BlackjackHistory.jsx');
    const c=rank=>({rank,suit:'S'});
    const base={action:'play',move:'stand',cards:[c('4'),c('3'),c('K')],dealerCard:[c('K')],tokens:40,bet:10,handCount:1};
    assert.equal(analyzeDecision(base).kind,'match');
    assert.equal(analyzeDecision({...base,move:'hit'}).kind,'deviation');
    assert.equal(analyzeDecision({...base,move:'hit',decisionEngine:'finite-shoe',math:{complete:true,scope:'whole-seat'}}).kind,'composition');
    assert.equal(analyzeDecision({...base,move:'hit',decisionEngine:'finite-shoe',math:{complete:false}}).kind,'deviation');
    assert.equal(analyzeDecision({...base,move:'hit',cards:[c('8'),c('8')],tokens:3}).kind,'funds');
    const html=render(History,{rows:[{accountId:'a',tableId:'t',roundNumber:1,netProfit:-10,reason:'dealer-higher',dealerCards:[c('K'),c('Q')],hands:[],actions:[{...base,sentAt:'2026-10-08T18:00:00Z',source:'auto',transitionMs:100,deadlineMarginMs:7000}]}],accounts:[{id:'a',label:'Teste'}],onExport:()=>{}});
    assert.match(html,/mão superior/);
    assert.match(html,/corresponde à estratégia básica/);
    assert.match(html,/100 ms/);
    assert.match(html,/Exportar análise/);
  }finally {await server.close();}
});

test('research controls expose per-account progression, unknown shoe coverage and short natural payout evidence',async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try {
    const {default:PayoutReview,ProgressionControl,ShoeReadout}=await server.ssrLoadModule('/src/BlackjackResearchPanel.jsx');
    const options=render(ProgressionControl,{value:'win-double-loss-half',running:true,onChange:()=>{}});
    assert.match(options,/<select[^>]+disabled/);assert.match(options,/selected=""[^>]*>Vitória ×2/);
    const coverage=render(ShoeReadout,{shoe:{usable:false,reason:'Início não observado'},stake:{amount:20,reason:'win'}});
    assert.match(coverage,/20 tokens/);assert.match(coverage,/Início não observado/);assert.doesNotMatch(coverage,/Hi-Lo/);
    const report=render(PayoutReview,{rows:[{accountId:'a',tableId:'t',roundNumber:1,netProfit:1,hands:[{result:'blackjack',bet:1,payout:2,cards:[{rank:'A'},{rank:'K'}]}]}]});
    assert.match(report,/1 abaixo desse valor/);assert.match(report,/0,5 tokens/);assert.match(report,/não confirma a regra/);
  }finally{await server.close();}
});
