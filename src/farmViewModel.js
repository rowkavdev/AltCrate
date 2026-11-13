import {getLocale} from './language.js';
export function farmLayoutForWidth(width) {
  return width < 760 ? {variant:'card',rowHeight:224} : {variant:'row',rowHeight:120};
}

export function formatVirtualMoney(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}

export function farmAccountState(entry, status, now = Date.now()) {
  if (entry?.needsLogin) return {key:'login',label:'Precisa de login',reason:'Inicia sessão novamente.'};
  if (entry?.paused && entry.networkRetryAt > 0) return {key:'waiting',label:'A recuperar ligação',reason:'A ligação será verificada antes de retomar.',nextAt:entry.networkRetryAt};
  if (entry?.paused) return {key:'paused',label:'Pausada',reason:entry.error || 'Retoma esta conta para continuar.'};
  if (['running','stopping'].includes(status?.phase) && entry?.inFlight) return {key:'active',label:'Em curso',reason:'A preparar ou confirmar o pedido.'};
  if (status?.phase !== 'running' || !entry?.selected || !Object.values(entry.modes || {}).some(Boolean)) return {key:'ready',label:'Pronta',reason:entry?.error || 'Aguarda o início da automação.'};
  if (entry.retryAt > now) return {key:'waiting',label:'Nova tentativa',reason:entry.error || 'A aguardar nova tentativa.',nextAt:entry.retryAt};
  const bothClicks = entry.modes?.case && entry.modes?.money;
  const budget = entry.budget || status?.budget;
  const cooldownUntil=Math.max(budget?.cooldownUntil||0,status?.budget?.cooldownUntil||0);
  if (cooldownUntil > now) return {key:'waiting',label:status?.budget?.cooldownUntil>now?'Limite do servidor':'Limite desta conta',reason:status?.budget?.cooldownUntil>now?'Pedidos suspensos pelo servidor.':'Esta conta aguarda o prazo indicado pelo servidor.',nextAt:cooldownUntil};
  const caseAvailable = entry?.modes?.case && !(entry.caseNextAt > now) && (Number.isFinite(budget?.caseClicksAvailable) ? budget.caseClicksAvailable > 0 : !budget || (budget.caseUsed || 0) < (bothClicks ? 950 : 2400) && (!(bothClicks || budget.moneyUsed > 0) || budget.combinedRemaining > 0));
  const moneyAvailable = entry?.modes?.money && (Number.isFinite(budget?.moneyClicksAvailable) ? budget.moneyClicksAvailable > 0 : !budget || (budget.moneyUsed || 0) < (bothClicks ? 950 : 1900) && (!(bothClicks || budget.caseUsed > 0) || budget.combinedRemaining > 0));
  const vaultAvailable = entry?.modes?.vault && (!entry.vaultNextAt || entry.vaultNextAt <= now);
  if (vaultAvailable) return {key:'queued',label:'Na fila',reason:'Verificar ou recolher cofre.'};
  if (caseAvailable || moneyAvailable) return {key:'queued',label:'Na fila',reason:'Aguarda a vez para '+(entry.nextClickMode === 'money' && moneyAvailable || !caseAvailable ? 'dinheiro.' : 'caixas.')};
  const next = [entry.modes?.vault && entry.vaultNextAt, entry.modes?.case && entry.caseNextAt, (entry.modes?.case || entry.modes?.money) && budget?.waitUntil].filter(at => at > now);
  const nextAt = next.length ? Math.min(...next) : null;
  return {key:'waiting',label:'Em espera',reason:nextAt === entry.vaultNextAt ? 'Cofre agendado.' : nextAt === entry.caseNextAt ? 'Próximo lote de caixas agendado.' : 'Aguarda cliques disponíveis.',nextAt};
}

export function farmAccountActivity(entry, status, now = Date.now()) {
  const {key} = farmAccountState(entry,status,now);
  return {active:key === 'active',waiting:key === 'waiting'};
}

export function farmCaseProgress(entry, status, now = Date.now()) {
  if (status?.execution?.kind === 'server' && !status.execution.connected) return 'stale';
  const metrics=entry?.performance;
  if (!metrics || !Number.isFinite(metrics.casesPerMinute5)) return 'collecting';
  if (status?.phase !== 'running' || !entry.selected || !entry.modes?.case || entry.paused || entry.needsLogin) return 'inactive';
  const grace=Math.max(300000,(entry.caseLotIntervalMs||0)*3);
  if (metrics.observedSeconds30*1000 < grace) return 'collecting';
  if (now-Math.max(metrics.lastCaseAt||0,metrics.measuredAt-metrics.observedSeconds30*1000)>grace && !(entry.budget?.cooldownUntil>now) && !(entry.caseNextAt>now) && !(entry.budget?.waitUntil>now)) return 'stalled';
  return 'measured';
}

export function farmPerformanceSummary(status, now = Date.now()) {
  const accounts=(status?.accounts||[]).filter(a=>a.selected);
  const measured=accounts.filter(a=>Number.isFinite(a.performance?.casesPerMinute5));
  return {available:accounts.length>0&&measured.length===accounts.length,
    stale:status?.execution?.kind==='server'&&!status.execution.connected,
    casesPerMinute5:measured.reduce((n,a)=>n+a.performance.casesPerMinute5,0),
    casesPerMinute30:measured.reduce((n,a)=>n+(a.performance.casesPerMinute30||0),0),
    observedSeconds30:measured.length?Math.min(...measured.map(a=>a.performance.observedSeconds30||0)):0,
    stalled:accounts.filter(a=>farmCaseProgress(a,status,now)==='stalled').length};
}

export function farmRunSummary(status, now = Date.now()) {
  const totals = {case:0,money:0,vault:0,unconfirmedRequests:0,active:0,queued:0,waiting:0,login:0,paused:0};
  for (const entry of status?.accounts || []) {
    const key = farmAccountState(entry,status,now).key;
    if (Object.hasOwn(totals,key)) totals[key]++;
    for (const kind of ['case','money','vault','unconfirmedRequests']) if (Number.isFinite(entry.results?.[kind]) && entry.results[kind] >= 0) totals[kind] += entry.results[kind];
  }
  return totals;
}

export function filterFarmAccounts(accounts, query = '', stateFilter = 'all', status = {}) {
  const byId = new Map((status.accounts || []).map((entry) => [entry.id, entry]));
  const needle = String(query).trim().toLocaleLowerCase();
  return accounts.filter((account) => {
    const state = byId.get(account.id);
    if (needle && !account.label.toLocaleLowerCase().includes(needle) && !account.id.toLocaleLowerCase().includes(needle)) return false;
    if (stateFilter === 'paused') return state?.paused === true;
    if (stateFilter === 'login') return state?.needsLogin === true;
    if (stateFilter === 'active') return farmAccountActivity(state,status).active;
    if (stateFilter === 'waiting') return farmAccountActivity(state,status).waiting;
    if (stateFilter === 'queued') return farmAccountState(state,status).key === 'queued';
    if (stateFilter === 'error') return !!state?.error;
    return true;
  });
}

export function visibleFarmAccounts(filtered, scrollTop = 0, rowHeight = 64, viewportHeight = 640) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  const count = Math.min(20, Math.ceil(viewportHeight / rowHeight) + 2);
  const start = Math.min(first, Math.max(0, filtered.length - count));
  const end = Math.min(filtered.length, start + count);
  return { start, end, items: filtered.slice(start, end) };
}
