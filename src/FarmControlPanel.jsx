import {t} from './language.js';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {farmAccountState,farmCaseProgress,farmPerformanceSummary,farmRunSummary,filterFarmAccounts,farmLayoutForWidth,formatVirtualMoney,visibleFarmAccounts} from './farmViewModel.js';
import {applyModesToAccounts} from './farmActions.js';
import AccountDetails from './components/AccountDetails.jsx';
import {formatNumber,formatTime} from './format.js';
import './farmControls.css';
const MODES=[['case','Caixas'],['money','Dinheiro'],['vault','Cofre']];

function RunResults({results}) {
 return <div className="farm-results"><span title={t("Caixas ganhas e confirmadas")}><b>{t(formatNumber(results?.case||0))}</b>{t(" caixas")}</span><span title={t("Dinheiro confirmado por cliques")}>{t("Dinheiro ")}<b>{t(formatVirtualMoney(results?.money||0))}</b></span><span title={t("Dinheiro confirmado do cofre")}>{t("Cofre ")}<b>{t(formatVirtualMoney(results?.vault||0))}</b></span></div>;
}

export default function FarmControlPanel({accounts,snapshots,status,bridge,onNotice,selectedIds,setSelectedIds,onRefresh,ui,onUiChange,operationPending,onInvoke}){
 const [local,setLocal]=useState({query:'',filter:'all',scrollTop:0,detailId:null,bulkModes:{case:true,money:true,vault:true}});
 const controls=ui||local;
 const update=patch=>onUiChange?onUiChange(patch):setLocal(old=>({...old,...patch}));
 const [localPending,setPending]=useState(false),[width,setWidth]=useState(960);
 const pending=operationPending??localPending;
 const [viewportHeight,setViewportHeight]=useState(570);
 const scrollRef=useRef(null),busy=useRef(false);
 const layout=farmLayoutForWidth(width);
 const selectedSet=useMemo(()=>new Set(selectedIds),[selectedIds]);
 const states=useMemo(()=>new Map((status?.accounts||[]).map(item=>[item.id,item])),[status]);
 const filtered=useMemo(()=>filterFarmAccounts(accounts,controls.query,controls.filter,status),[accounts,controls.query,controls.filter,status]);
 const windowed=visibleFarmAccounts(filtered,controls.scrollTop,layout.rowHeight,viewportHeight);
 const running=['running','stopping'].includes(status?.phase);
 const summary=farmRunSummary(status),performance=farmPerformanceSummary(status);
 const detail=accounts.find(item=>item.id===controls.detailId),detailEntry=states.get(detail?.id);
 useEffect(()=>{
  const element=scrollRef.current;if(!element)return;
  const observer=new ResizeObserver(([entry])=>{setWidth(entry.contentRect.width);setViewportHeight(entry.contentRect.height);});
  observer.observe(element);return()=>observer.disconnect();
 },[filtered.length>0]);
 useEffect(()=>{
  const element=scrollRef.current;if(!element)return;
  const top=Math.min(controls.scrollTop||0,Math.max(0,filtered.length*layout.rowHeight-viewportHeight));
  element.scrollTop=top;
  if(top!==controls.scrollTop)update({scrollTop:top});
 },[layout.rowHeight,filtered.length]);
 async function invoke(action){
  if(onInvoke)return onInvoke(action);
  if(busy.current)return;busy.current=true;setPending(true);
  try{await action();}catch(error){onNotice(error.message||String(error));}finally{busy.current=false;setPending(false);}
 }
 function changeMode(entry,kind){const modes={...entry.modes,[kind]:!entry.modes[kind]};return invoke(()=>bridge.farmSetModes(entry.id,modes));}
 function applyGroup(modes=controls.bulkModes){return invoke(async()=>{
   const result=await applyModesToAccounts(bridge,selectedIds,modes);
   const failed=result.failures.map(item=>(accounts.find(account=>account.id===item.accountId)?.label||'Conta')+': '+item.message);
   onNotice(result.appliedIds.length+' contas configuradas'+(failed.length?' · '+failed.join(' · '):'.'));
 });}
 function setFilter(patch){update({...patch,scrollTop:0});if(scrollRef.current)scrollRef.current.scrollTop=0;}
 const cooldown=status?.budget?.cooldownUntil>Date.now()?status.budget.cooldownUntil:0;
 const windowWait=Boolean(running&&status?.budget?.waitUntil>Date.now()&&(summary.waiting>0||cooldown));
 const limited=running&&!cooldown?(status?.accounts||[]).filter(entry=>entry.selected&&entry.budget?.cooldownUntil>Date.now()):[];
 return <div className="farm-control">
  {status?.execution?.kind==='server'&&<p className="farm-window"><strong>{t("Farm no servidor")}{status.execution.name&&<> · {status.execution.name}</>}</strong> · {t(status.execution.connected?'Ligado. Continua com a app fechada.':'Sem ligação à app. Último estado conhecido; o farm pode continuar no servidor.')}{status.execution.updatedAt&&<>{t(" Atualizado às ")}{t(formatTime(status.execution.updatedAt))}.</>}</p>}
  <div className="farm-overview" aria-label={t("Resumo da automação")}><span><strong>{t(summary.active)}</strong>{t(" em curso")}</span><span><strong>{t(summary.queued)}</strong>{t(" na fila")}</span><span><strong>{t(summary.waiting)}</strong>{t(" em espera")}</span><span><strong>{t(summary.login+summary.paused)}</strong>{t(" por resolver")}</span></div>
  <div className="farm-run-results"><div><span className="farm-caption">{t("GANHOS CONFIRMADOS · ACUMULADOS")}</span><RunResults results={summary}/></div>{summary.unconfirmedRequests>0&&<small>{t(summary.unconfirmedRequests)} {t(summary.unconfirmedRequests===1?'pedido por confirmar':'pedidos por confirmar')}</small>}</div>
  <div className="farm-performance" aria-label={t('Rendimento do farm')}><span><strong>{performance.available?t(formatNumber(performance.casesPerMinute5,2)):'—'}</strong> {t('caixas/min · 5 min')}</span><span><strong>{performance.available?t(formatNumber(performance.casesPerMinute30,2)):'—'}</strong> {t('caixas/min · 30 min')}</span><small>{t(performance.stale?'Última medição; servidor sem ligação à app.':!performance.available?'A recolher dados de ganhos confirmados.':performance.observedSeconds30<1800?'Média parcial desde o início da medição.':'Médias incluem períodos sem ganhos.')}</small>{performance.stalled>0&&<small className="farm-stalled">{t(performance.stalled)} {t('contas sem ganhos recentes; consulta os detalhes.')}</small>}</div>
  {status?.execution?.kind!=='server'&&status?.network?.connections>1&&<p className="form-note">{t(status.network.connections)}{t(" ligações verificadas · ")}{t(status.network.proxiedAccounts)}{t(" contas distribuídas por proxies. Os lotes avançam ao longo da janela de cliques.")}</p>}
  {status?.network?.configured&&status.network.unavailableProxies>0&&<p className="form-note">{t(status.network.unavailableProxies)} {t(status.network.unavailableProxies===1?'ligação indisponível':'ligações indisponíveis')}{t(". A execução usa as ligações verificadas.")}</p>}
  {status?.limitCheck&&<p className="farm-window">{t("A verificar se outras contas podem continuar…")}</p>}
  {!status?.limitCheck&&limited.length>0&&<p className="farm-window">{t(limited.length)} {t(limited.length===1?'conta aguarda':'contas aguardam')}{t(" o servidor")}{t(limited.length<(status?.accounts||[]).filter(entry=>entry.selected).length?'; as restantes continuam.':'.')}{t(" Próxima retoma às ")}<strong>{t(formatTime(Math.min(...limited.map(entry=>entry.budget.cooldownUntil))))}</strong></p>}
  {windowWait&&!status?.limitCheck&&!limited.length&&<p className="farm-window">{t(cooldown?'Limite do servidor: pedidos retomam às ':'Contas em espera retomam às ')}<strong>{t(formatTime(cooldown||status.budget.waitUntil))}</strong>{t(!cooldown&&' · Os cofres continuam no seu horário.')}</p>}
  {status?.execution?.kind==='local'&&bridge?.farmMoveToServer&&<p className="form-note">{status.execution.configuredServer?<>{t('Servidor escolhido: ')}<strong>{status.execution.configuredServer.name}</strong> · {status.execution.configuredServer.host}{t('. Ao enviar, as sessões das contas selecionadas ficam neste servidor.')}</>:<a href="#settings">{t('Configura o teu servidor nas Definições.')}</a>}</p>}
  <div className="farm-toolbar">
   {status?.execution?.kind!=='server'&&bridge?.farmMoveToServer&&<button type="button" disabled={pending||!selectedIds.length||!status?.execution?.configuredServer||status.execution.restartRequired||Boolean(status.execution.transition)} onClick={()=>invoke(()=>bridge.farmMoveToServer(selectedIds))}>{t("Enviar contas para o servidor")}</button>}
   {running?<button type="button" className="stop-button" disabled={pending||status?.phase==='stopping'} onClick={()=>invoke(()=>bridge.farmStop())}>{t(status.phase==='stopping'?'A parar…':'Parar tudo')}</button>:<button type="button" className="primary-button" disabled={pending||!bridge||!selectedIds.length||status?.execution?.restartRequired||Boolean(status?.execution?.transition)} onClick={()=>invoke(()=>bridge.farmStart(selectedIds))}>{t("Iniciar caixas, dinheiro e cofre")}</button>}
   {!running&&<><button type="button" disabled={pending||!accounts.length} onClick={()=>setSelectedIds(accounts.map(item=>item.id))}>{t("Selecionar todas")}</button><button type="button" disabled={pending||!selectedIds.length} onClick={()=>setSelectedIds([])}>{t("Limpar seleção")}</button></>}
   <span>{t(selectedIds.length)}{t(" de ")}{t(accounts.length)} {t(selectedIds.length===1?'selecionada':'selecionadas')}</span>{running&&<span>{t(formatNumber(status.clicksAvailable??status.budget?.combinedRemaining))}{t(" cliques disponíveis")}</span>}<details className="farm-configuration"><summary>{t("Configurar modos")}</summary><fieldset className="bulk-modes"><legend>{t("Modos nas contas selecionadas")}</legend><div>{MODES.map(([kind,label])=><label key={kind}><input type="checkbox" checked={controls.bulkModes?.[kind]===true} disabled={pending} onChange={()=>update({bulkModes:{...controls.bulkModes,[kind]:!controls.bulkModes?.[kind]}})}/>{t(label)}</label>)}</div><button type="button" disabled={pending||!bridge||!selectedIds.length} onClick={applyGroup}>{t(pending?'A aplicar…':'Aplicar modos')}</button><button type="button" disabled={pending||!bridge||!selectedIds.length} onClick={()=>{const modes={case:true,money:false,vault:true};update({bulkModes:modes});applyGroup(modes);}}>{t('Prioridade caixas e cofre')}</button><small>{t('Prioridade caixas desliga o dinheiro por clique nas contas selecionadas. O cofre continua; os limites mantêm-se.')}</small><small>{t(running?'Aplica os modos às contas da execução atual.':'Configura os modos; a execução começa em Iniciar.')}</small></fieldset></details>
  </div>
  <div className="farm-search"><input aria-label={t("Pesquisar contas")} placeholder={t("Pesquisar por nome ou email…")} value={controls.query} onChange={event=>setFilter({query:event.target.value})}/><select aria-label={t("Filtrar contas")} value={controls.filter} onChange={event=>setFilter({filter:event.target.value})}><option value="all">{t("Todas")}</option><option value="active">{t("Em curso")}</option><option value="queued">{t("Na fila")}</option><option value="waiting">{t("Em espera")}</option><option value="error">{t("Com erro")}</option><option value="paused">{t("Pausadas")}</option><option value="login">{t("Pedem login")}</option></select><span>{t(filtered.length)}{t(" de ")}{t(accounts.length)}</span></div>
  {filtered.length?<div className={'farm-table layout-'+layout.variant}>
   {layout.variant==='row'&&<div className="farm-table-head" aria-hidden="true"><span>{t("Conta / modos")}</span><span>{t("Ganhos acumulados")}</span><span>{t("Próxima ação")}</span><span>{t("Ações")}</span></div>}
   <div className={'farm-scroll layout-'+layout.variant} ref={scrollRef} aria-label={t("Contas da automação")} onScroll={event=>update({scrollTop:event.currentTarget.scrollTop})}><div style={{height:filtered.length*layout.rowHeight,position:'relative'}}>{windowed.items.map((account,offset)=>{
    const entry=states.get(account.id),state=farmAccountState(entry,status),last=entry?.last,progress=farmCaseProgress(entry,status);
    const lastResult=last?(last.ok===false?'Último pedido recusado':last.confirmedDelta==null?'Último pedido por confirmar':(MODES.find(([kind])=>kind===last.kind)?.[1]||'Operação')+' · +'+(last.kind==='case'?formatNumber(last.confirmedDelta)+' caixas confirmadas':formatVirtualMoney(last.confirmedDelta)+' confirmado')):'';
    return <article className="farm-row" key={account.id} style={{top:(windowed.start+offset)*layout.rowHeight,height:layout.rowHeight}}>
     <div className="farm-account-cell"><label className="farm-account"><input type="checkbox" aria-label={t('Selecionar '+account.label)} checked={selectedSet.has(account.id)} disabled={pending||running} onChange={()=>setSelectedIds(old=>old.includes(account.id)?old.filter(id=>id!==account.id):[...old,account.id])}/><strong title={t(account.label)}>{account.label}</strong></label><div className="farm-account-meta"><span className={'farm-state state-'+state.key}>{t(state.label)}</span><span className="farm-mode-tags" aria-label={t('Modos de '+account.label)}>{MODES.filter(([kind])=>entry?.modes?.[kind]).map(([kind,label])=><span key={kind} title={t(label)}>{t(label)}</span>)}</span></div></div>
     <div className="farm-account-results"><RunResults results={entry?.results}/><small className={progress==='stalled'?'farm-stalled':'farm-account-rate'}>{t(entry?.performance&&Number.isFinite(entry.performance.casesPerMinute5)?formatNumber(entry.performance.casesPerMinute5,2)+' caixas/min · 5 min':'A recolher dados')}{progress==='stalled'&&<> · {t('Sem ganhos recentes')}</>}</small><small title={t(lastResult)}>{t(lastResult||'Sem resultado nesta execução')}</small></div>
     <div className="farm-next"><span title={t(entry?.error||state.reason)}>{t(state.reason)}</span>{state.nextAt&&<strong>{t(formatTime(state.nextAt))}</strong>}</div>
     <div className="farm-row-actions"><button type="button" disabled={pending||!entry} onClick={()=>invoke(()=>entry.paused?bridge.farmResume(account.id):bridge.farmPause(account.id))}>{t(entry?.paused?'Retomar':'Pausar')}</button><button type="button" aria-label={t('Detalhes de '+account.label)} onClick={()=>update({detailId:account.id})}>{t("Detalhes")}</button></div>
    </article>;
   })}</div></div>
  </div>:<div className="empty-state"><h2>{t(accounts.length?'Nenhuma conta neste filtro':'Adiciona uma conta para começar')}</h2><p>{t(accounts.length?'Ajusta a pesquisa ou o estado selecionado.':'A página Contas permite ligar e validar as sessões.')}</p></div>}
  {detail&&<AccountDetails account={detail} snapshot={snapshots[detail.id]} operation={detailEntry} onClose={()=>update({detailId:null})}>
   <div className="farm-detail-controls"><fieldset className="bulk-modes"><legend>{t("Modos de ")}{detail.label}</legend><div>{MODES.map(([kind,label])=><label key={kind}><input type="checkbox" checked={detailEntry?.modes?.[kind]===true} disabled={pending||!detailEntry} onChange={()=>changeMode(detailEntry,kind)}/>{t(label)}</label>)}</div></fieldset>{detailEntry?.clicksPerCase&&<p>{t(formatNumber(detailEntry.casesPerClick,2))}{t("% por clique · ")}{t(detailEntry.clicksPerCase)}{t(" cliques por caixa. Os lotes usam caixas completas.")}{detailEntry.caseLotClicks>0&&<>{t(" Até ")}{t(detailEntry.caseLotClicks)}{t(" cliques por lote, com ")}{t(formatNumber(detailEntry.caseLotIntervalMs/1000,1))}{t(" s de intervalo.")}</>}</p>}<RunResults results={detailEntry?.results}/>{detailEntry?.performance&&<div className="farm-performance"><span>{Number.isFinite(detailEntry.performance.casesPerMinute5)?t(formatNumber(detailEntry.performance.casesPerMinute5,2)):'—'} {t('caixas/min · 5 min')}</span><span>{Number.isFinite(detailEntry.performance.casesPerMinute30)?t(formatNumber(detailEntry.performance.casesPerMinute30,2)):'—'} {t('caixas/min · 30 min')}</span></div>}<p>{t('Último ganho de caixas confirmado: ')}{detailEntry?.performance?.lastCaseAt?t(formatTime(detailEntry.performance.lastCaseAt)):t('Ainda sem confirmação nesta medição.')}</p><p>{t('Stock observado: ')}{t(formatNumber(snapshots[detail.id]?.casesTotal))}{t(' caixas. Abrir caixas reduz o stock; não apaga os ganhos do farm.')}</p><p>{t(farmAccountState(detailEntry,status).reason)}</p><button type="button" disabled={pending} onClick={()=>invoke(()=>onRefresh(detail.id))}>{t("Atualizar conta")}</button></div>
  </AccountDetails>}
 </div>;
}
