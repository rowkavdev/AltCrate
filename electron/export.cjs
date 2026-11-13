function finite(value) { return value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null; }

function safeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    money: finite(snapshot.money),
    tokens: finite(snapshot.tokens),
    moneyPerClick: finite(snapshot.moneyPerClick),
    casesPerClick: finite(snapshot.casesPerClick),
    inventoryCount: finite(snapshot.inventoryCount),
    casesTotal: finite(snapshot.casesTotal),
    cases: Array.isArray(snapshot.cases) ? snapshot.cases.map((item) => ({
      id: String(item.id || ''), name: String(item.name || '').slice(0, 80), amount: finite(item.amount),
    })) : [],
  };
}

function safeEvent(event) {
  const base = { type: String(event.type || ''), at: String(event.at || ''), accountId: String(event.accountId || '') };
  if(event.type==='inventory-action')return {...base,operationId:String(event.operationId||'').slice(0,100),kind:['sell','convert','favorite','withdraw','transfer','move-to-storage'].includes(event.kind)?event.kind:'',destinationAccountId:String(event.destinationAccountId||''),destinationStorageUnitId:/^[a-f0-9]{24}$/i.test(event.destinationStorageUnitId||'')?event.destinationStorageUnitId:'',destinationStorageName:String(event.destinationStorageName||'').slice(0,180),locationAccountId:String(event.locationAccountId||''),item:require('./inventoryView.cjs').normalizeInventoryItem({_id:event.item?.id,name:event.item?.name,iconUrl:event.item?.image,price:event.item?.price,rarity:event.item?.rarity,isFavorite:event.item?.isFavorite}),state:String(event.state||''),stage:String(event.stage||'').slice(0,50),message:String(event.message||'').slice(0,300),verified:event.verified===true,httpStatus:finite(event.httpStatus),observedMoney:finite(event.observedMoney),observedTokens:finite(event.observedTokens),location:['inventory','storage','unknown'].includes(event.location)?event.location:'unknown'};
  if(event.type==='progression') return {...base,kind:['reward','mission','pass','skill-buy','skill-sell','skill-preset','autoopen'].includes(event.kind)?event.kind:'',title:String(event.title||'').slice(0,180),state:String(event.state||'').slice(0,40),verified:event.verified===true,completed:finite(event.completed),total:finite(event.total),message:String(event.message||'').slice(0,300)};
  if (event.type === 'request') {
    const before = safeSnapshot(event.before);
    const after = safeSnapshot(event.after);
    return {
      ...base, kind: event.kind === 'money' ? 'money' : 'case', clicks: finite(event.clicks), httpStatus: finite(event.httpStatus),
      awardedCount: finite(event.awardedCount), caseName: String(event.caseName || '').slice(0, 80),
      caseId: String(event.caseId || ''), before, after,
      verifiedDelta: before && after ? event.kind === 'money'
        ? (before.money !== null && after.money !== null ? after.money - before.money : null)
        : (before.casesTotal !== null && after.casesTotal !== null ? after.casesTotal - before.casesTotal : null) : finite(event.verifiedDelta),
    };
  }
  if (event.type === 'open') return { ...base, caseId: String(event.caseId || ''), httpStatus: finite(event.httpStatus), openedCount: finite(event.openedCount), observedCaseDelta: finite(event.observedCaseDelta), skinCount: finite(event.skinCount),
    acceptedCount: finite(event.acceptedCount), confirmedCount: finite(event.confirmedCount), unconfirmedCount: finite(event.unconfirmedCount), requestedCount: finite(event.requestedCount),
    verified: event.verified === true, verification: ['confirmed','unconfirmed','rejected'].includes(event.verification) ? event.verification : 'unconfirmed',
    selectedCaseBefore: finite(event.selectedCaseBefore), selectedCaseAfter: finite(event.selectedCaseAfter), selectedCaseDelta: finite(event.selectedCaseDelta),
    skinIds: Array.isArray(event.skinIds) ? event.skinIds.filter(id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)).slice(0,1000) : [],
    beforeReadAt: String(event.beforeReadAt || '').slice(0,40), afterReadAt: String(event.afterReadAt || '').slice(0,40), message: String(event.message || '').slice(0,300) };
  if (event.type === 'vault') return { ...base, httpStatus: finite(event.httpStatus), confirmedDelta: finite(event.confirmedDelta) };
  if (event.type === 'conversion') return { ...base, skinId: String(event.skinId || ''), skinName: String(event.skinName || '').slice(0, 100), price: finite(event.price), conversionMode: event.conversionMode === 'money' ? 'money' : 'tokens', httpStatus: finite(event.httpStatus), verified: event.verified === true, tokenDelta: finite(event.tokenDelta), moneyDelta: finite(event.moneyDelta) };
  if (event.type === 'game') return {
    ...base, game: String(event.game || '').slice(0, 30), action: String(event.action || '').slice(0, 30),
    httpStatus: finite(event.result?.status), verified: event.result?.verified === true,
    diceRoll: finite(event.result?.diceRoll), tokensWonOrLost: finite(event.result?.tokensWonOrLost),
    bet: finite(event.result?.bet), multiplier: finite(event.result?.multiplier),
    tokensWon: finite(event.result?.tokensWon), rank: finite(event.result?.rank),
    won: event.result?.won === true, skinName: String(event.result?.skinName || '').slice(0, 100),
  };
  if (event.type === 'cooldown') return { ...base, until: finite(event.until), ...(['case','money','vault'].includes(event.operation) ? {operation:event.operation} : {}), ...(['read','request'].includes(event.stage) ? {stage:event.stage} : {}), ...(event.httpStatus===429 ? {httpStatus:429} : {}), ...(['/api/me','/api/cases','/api/click','/api/caseClick','/api/vault'].includes(event.endpoint)?{endpoint:event.endpoint}:{}), ...(['account','global'].includes(event.scope)?{scope:event.scope,verifiedScope:event.verifiedScope===true}:{}) };
  if (['waiting', 'budget-wait'].includes(event.type)) return { ...base, until: finite(event.until) };
  if(event.type==='account-error'&&event.errorCategory)return {...base,...require('./farmFailure.cjs').safeFailure(event)};
  if(event.type==='farm-finished'&&event.reason==='accounts-unavailable')return {...base,reason:'accounts-unavailable'};
  return base;
}

function safeStatus(status) {
  return {
    phase: String(status?.phase || 'idle'), sent: finite(status?.sent),
    succeeded: finite(status?.succeeded), failed: finite(status?.failed),
    opened: finite(status?.opened), accepted: finite(status?.accepted), confirmed: finite(status?.confirmed), unconfirmed: finite(status?.unconfirmed), converted: finite(status?.converted),
  };
}

function safeFarm(status) {
  return {
    phase: String(status?.phase || 'idle'),
    budget: status?.budget ? {
      caseRemaining: finite(status.budget.caseRemaining), moneyRemaining: finite(status.budget.moneyRemaining),
      combinedRemaining: finite(status.budget.combinedRemaining), cooldownUntil: finite(status.budget.cooldownUntil),
    } : null,
    accounts: Array.isArray(status?.accounts) ? status.accounts.map((account) => ({
      id: String(account.id || ''), selected: account.selected === true,
      modes: { case: account.modes?.case === true, money: account.modes?.money === true, vault: account.modes?.vault === true },
      casesPerClick: finite(account.casesPerClick), clicksPerCase: finite(account.clicksPerCase),
      caseLotClicks: finite(account.caseLotClicks), caseLotIntervalMs: finite(account.caseLotIntervalMs),
      ...(account.performance ? {performance:Object.fromEntries(['measuredAt','lastCaseAt','observedSeconds5','observedSeconds30','cases5','cases30','casesPerMinute5','casesPerMinute30'].map(key=>[key,finite(account.performance[key])]))} : {}),
      paused: account.paused === true, needsLogin: account.needsLogin === true,
      retryAt: finite(account.retryAt), vaultNextAt: finite(account.vaultNextAt),
      last: account.last ? {kind: ['case','money','vault'].includes(account.last.kind) ? account.last.kind : '', at: String(account.last.at || ''), confirmedDelta: finite(account.last.confirmedDelta), ok: account.last.ok === true} : null,
    })) : [],
  };
}

function createReport({ accounts = [], status = {}, events = [], blackjack = [], inventoryOperations = [], now = new Date().toISOString() }) {
  return {
    application: 'Case Clicker Dashboard', exportedAt: String(now),
    site: 'https://case-clicker.com',
    accounts: accounts.map((account) => ({ id: String(account.id || ''), label: String(account.label || '') })),
    run: status.case || status.money || status.generation || status.opening || status.vault || status.farm ? {
      case: safeStatus(status.case || status.generation), money: safeStatus(status.money), opening: safeStatus(status.opening), vault: safeStatus(status.vault), farm: safeFarm(status.farm),
    } : safeStatus(status),
    events: events.map(safeEvent),
    inventoryOperations: Array.isArray(inventoryOperations)?inventoryOperations.map(operation=>safeEvent({...operation,type:'inventory-action',at:operation.updatedAt||''})):[],
    blackjack: Array.isArray(blackjack) ? blackjack.slice(0,400).map(require('./blackjackAudit.cjs').safeAuditRound) : [],
  };
}
module.exports = { createReport, safeEvent };
