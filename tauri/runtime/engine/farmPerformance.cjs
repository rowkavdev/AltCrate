const WINDOW = 30 * 60 * 1000;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(id);
function emptyPerformance(now = Date.now()) { return {version:1,startedAt:now,accounts:{}}; }
function cleanPerformance(raw, now = Date.now()) {
  if (!raw) return emptyPerformance(now);
  if (raw.version !== 1 || !Number.isFinite(raw.startedAt) || raw.startedAt < 0 || !raw.accounts || typeof raw.accounts !== 'object' || Array.isArray(raw.accounts) || Object.keys(raw.accounts).length > 10000) throw Error('Métricas de farm inválidas');
  const state = emptyPerformance(Math.min(now,raw.startedAt));
  for (const [id, row] of Object.entries(raw.accounts)) {
    if (!validId(id) || !Array.isArray(row.awards) || row.awards.length > 20000 || !Number.isFinite(row.lastCaseAt) || row.lastCaseAt < 0 || (row.startedAt!==undefined&&(!Number.isFinite(row.startedAt)||row.startedAt<0))) throw Error('Métricas de conta inválidas');
    for (const pair of row.awards) if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite) || pair[0] < 0 || pair[1] <= 0) throw Error('Ganhos medidos inválidos');
    state.accounts[id] = {startedAt:Number.isFinite(row.startedAt)?Math.min(now,row.startedAt):state.startedAt,lastCaseAt:row.lastCaseAt,awards:row.awards.filter(([at])=>at>now-WINDOW&&at<=now).map(pair=>[...pair])};
  }
  return state;
}
function recordPerformance(state, event, now = Date.now()) {
  if (event.type !== 'request' || event.kind !== 'case' || event.httpStatus !== 200 || !validId(event.accountId) || !Number.isFinite(event.verifiedDelta) || event.verifiedDelta <= 0) return;
  const at = Date.parse(event.at);
  // Missing timestamps cannot establish when an award happened.
  if (!Number.isFinite(at) || at < 0 || at > now) return;
  const row = Object.hasOwn(state.accounts,event.accountId)?state.accounts[event.accountId]:(state.accounts[event.accountId]={startedAt:state.startedAt,lastCaseAt:0,awards:[]});
  row.lastCaseAt = Math.max(row.lastCaseAt,at);
  row.awards = row.awards.filter(([time])=>time>now-WINDOW);
  if (at > now-WINDOW) row.awards.push([at,event.verifiedDelta]);
}
function performanceFor(state, id, now = Date.now()) {
  if(!validId(id))throw Error('Conta de métricas inválida');
  const row = Object.hasOwn(state.accounts,id)?state.accounts[id]:(state.accounts[id]={startedAt:now,lastCaseAt:0,awards:[]});
  const result = {measuredAt:now,lastCaseAt:row.lastCaseAt||null};
  for (const minutes of [5,30]) {
    const duration = Math.max(0,Math.min(minutes*60000,now-(row.startedAt??state.startedAt)));
    const cases = row.awards.reduce((sum,[at,delta])=>at>now-minutes*60000&&at>=(row.startedAt??state.startedAt)&&at<=now?sum+delta:sum,0);
    result['observedSeconds'+minutes] = duration/1000;
    result['cases'+minutes] = cases;
    result['casesPerMinute'+minutes] = duration>=15000 ? cases/(duration/60000) : null;
  }
  return result;
}
module.exports = {emptyPerformance,cleanPerformance,recordPerformance,performanceFor};
