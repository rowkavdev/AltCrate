import {t} from './language.js';
import {toOperationProfileRules} from './operationProfile.js';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {commonCaseChoices} from './workspaceViewModel.js';
import {groupCaseAwards} from './caseAwards.js';
import {createAccountRefreshQueue} from './accountRefresh.js';
import {accountSummaryCache} from './accountSummaryCache.js';
import {pendingLoginIds as getPendingLoginIds} from './accountSessions.js';
import {observedSnapshot,failedSnapshot,overviewReadings} from './accountReadState.js';
import {planOverviewRefresh} from './overviewRefresh.js';
import {createRequestPool} from './requestPool.js';
import {createStatusPoller} from './statusPolling.js';
export function calculateAccountTotals(accounts,snapshots){
  return accounts.reduce((sum,account)=>{
    const snapshot=snapshots[account.id];
    if(snapshot&&!snapshot.error){

      sum.cases+=snapshot.casesTotal||0;
      sum.money+=snapshot.money||0;
      sum.tokens+=Number.isFinite(snapshot.tokens)?snapshot.tokens:0;
    }
    if(account.session?account.session.reusable:snapshot&&!snapshot.error)sum.connected++;
    return sum;
  },{connected:0,cases:0,money:0,tokens:0});
}
export function useWorkspaceModel(bridge) {
  const [accounts, setAccounts] = useState([]);
  const [accountWorkspace,setAccountWorkspace]=useState(null);
  const [extensionCapabilities,setExtensionCapabilities]=useState([]);
  const [loadedOperationProfile,setLoadedOperationProfile]=useState(null);
  const [profileRules,setProfileRules]=useState(()=>{try{return JSON.parse(localStorage.getItem('casepilot:opening-rules-v1')||'{}')||{};}catch{return {};}});
  const [accountLogin,setAccountLogin]=useState({phase:'idle'});
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [refreshStatus,setRefreshStatus]=useState({phase:'idle',total:0,processed:0,succeeded:0,failed:0});
  const [autoRefreshPaused,setAutoRefreshPaused]=useState(false);
  const [snapshots, setSnapshots] = useState(()=>{try{return accountSummaryCache(JSON.parse(localStorage.getItem('casepilot:account-summary-cache')||'{}'));}catch{return {};}});
  const [selectedIds, setSelectedIds] = useState([]);
  const [bettingIds, setBettingIds] = useState([]);
  const [blackjackStats, setBlackjackStats] = useState({ rounds: {}, byAccount: {} });
  const [events, setEvents] = useState([]);
  const [inventoryOperations,setInventoryOperations]=useState({});
  const [inventoryRevision,setInventoryRevision]=useState({});
  const [farmStatus, setFarmStatus] = useState({ phase: 'idle', accounts: [], budget: null });
  const [converter,setConverter]=useState({phase:'idle',rows:[],sentTokens:0});
  const currentConverter=useRef(converter);currentConverter.current=converter;
  const [opening, setOpening] = useState({ phase: 'idle', opened: 0, converted: 0, failed: 0, cooldownUntil: 0 });
  const [label, setLabel] = useState('');
  const [caseId, setCaseId] = useState('');
  const [convert, setConvert] = useState(false);
  const [conversionMode, setConversionMode] = useState('tokens');
  const [maxPrice, setMaxPrice] = useState('5');
  const [localBusy, setBusy] = useState(false);
  const [farmPending,setFarmPending]=useState(false);
  const farmOperation=useRef(false);
  const busy=localBusy||farmPending||['running','stopping'].includes(accountLogin.phase);
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(Date.now());
  const snapshotVersion = useRef({});
  const refreshQueue = useRef(null);
  const refreshSource = useRef(null), automaticPaused = useRef(false), statusPoller = useRef(null), mounted = useRef(false);
  const currentFarm=useRef(farmStatus);
  currentFarm.current=farmStatus;
  const running = ['running', 'stopping'].includes(farmStatus.phase) || ['running', 'stopping'].includes(opening.phase)||['preparing','revalidating','running','stopping'].includes(converter.phase);
  const accountsById=useMemo(()=>new Map(accounts.map(account=>[account.id,account])),[accounts]);
  const latest = useRef(null);
  latest.current={accounts,accountsById,snapshots,loading,loadError,busy,running,autoRefreshPaused,refreshStatus,opening,converter,accountLogin};

  const readAccount = useMemo(()=>createRequestPool(async id => {
    const version = (snapshotVersion.current[id] || 0) + 1;
    snapshotVersion.current[id] = version;
    try { const snapshot = observedSnapshot(await bridge.refreshAccount(id)); if (mounted.current && snapshotVersion.current[id] === version) setSnapshots((old) => ({ ...old, [id]: snapshot })); return snapshot; }
    catch (error) { if (mounted.current && snapshotVersion.current[id] === version) setSnapshots((old) => ({ ...old, [id]: failedSnapshot(old[id],error) })); throw error; }
  }),[bridge]);
  const refreshAccount=useCallback((id,{throwOnError=false}={})=>{
    if(!bridge||!id||currentConverter.current.retryAt>Date.now())return Promise.resolve();
    const request=readAccount(id);
    return throwOnError?request:request.catch(()=>undefined);
  },[bridge,readAccount]);
  const refreshAccounts=useCallback(async(options={})=>{
    const {accounts,snapshots,loading,loadError,busy,running}=latest.current;
    const status=refreshQueue.current?.status()||{};
    const cooldownUntil=Math.max(currentFarm.current.budget?.cooldownUntil||0,currentConverter.current.retryAt||0);
    if(!bridge||loading||loadError||busy||running||Math.max(status.retryAt||0,cooldownUntil)>Date.now())return;
    if(['running','stopping'].includes(status.phase))return refreshQueue.current.run([]);
    const eligible=accounts.filter(account=>!account.session||account.session.reusable);
    const targets=options.automatic===true?planOverviewRefresh({accounts,snapshots,refreshStatus:status,paused:automaticPaused.current,cooldownUntil,visible:document.visibilityState==='visible',online:navigator.onLine!==false}).targets:options.remaining===true?eligible.filter(account=>!snapshots[account.id]?.observedAt||Date.parse(snapshots[account.id].observedAt)<status.startedAt||snapshots[account.id].refreshError):eligible;
    if(!targets.length)return;
    if(!options.automatic){automaticPaused.current=false;setAutoRefreshPaused(false);}
    refreshSource.current=options.automatic?'automatic':'manual';
    try{return await refreshQueue.current?.run(targets);}finally{refreshSource.current=null;}
  },[bridge]);
  const stopRefresh=useCallback(()=>{automaticPaused.current=true;setAutoRefreshPaused(true);refreshQueue.current?.stop();},[]);
  const stopAutomaticRefresh=useCallback(()=>{if(refreshSource.current==='automatic')refreshQueue.current?.stop();},[]);
  useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem('casepilot:account-summary-cache',JSON.stringify(accountSummaryCache(snapshots)));}catch{}},500);return()=>clearTimeout(timer);},[snapshots]);

  useEffect(()=>{if(farmStatus?.execution?.kind==='server'&&farmStatus.observations)setSnapshots(old=>({...old,...farmStatus.observations}));},[farmStatus.observations]);

  useEffect(() => {
    if (!bridge) return;
    mounted.current=true;
    let live = true;
    const poller=createStatusPoller({
      visible:()=>document.visibilityState==='visible'&&navigator.onLine!==false,
      active:()=>['running','stopping'].includes(currentFarm.current.phase)||currentFarm.current.budget?.cooldownUntil>Date.now()||['running','stopping'].includes(latest.current.opening.phase)||['preparing','revalidating','running','stopping'].includes(currentConverter.current.phase)||currentConverter.current.retryAt>Date.now(),
      poll:async()=>{
        const results=await Promise.allSettled([bridge.farmStatus().then(status=>{if(live){currentFarm.current=status;setFarmStatus(status);}}),bridge.getTokenConverterStatus?.().then(status=>{if(live)setConverter(status);})]);
        if(results.some(result=>result.status==='rejected'))throw Error('Status unavailable');
      },
    });
    statusPoller.current=poller;
    const wake=()=>poller.wake();
    document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
    Promise.all([bridge.listAccounts(), bridge.farmStatus(), bridge.getOpeningStatus()]).then(([items, status, openStatus]) => { if (!live) return; setAccounts(items); setSelectedIds(status.phase === 'running' ? status.accounts.filter(item=>item.selected).map(item=>item.id) : items.map(item=>item.id)); setFarmStatus(status); currentFarm.current=status; setOpening(openStatus); }).catch((error) => {if(live){const message=error?.message||String(error);setLoadError(message);setNotice(message);}}).finally(()=>{if(live){setLoading(false);poller.schedule();}});
    bridge.extensionCapabilities?.().then(value=>{if(live)setExtensionCapabilities(value);}).catch(error=>{if(live)setNotice(error.message);});
    bridge.readAccountWorkspace?.().then(value=>{if(live)setAccountWorkspace(value);}).catch(error=>{if(live)setNotice(error.message);});
    bridge.getTokenConverterStatus?.().then(status=>{if(live)setConverter(status);}).catch(()=>{});
    bridge.accountLoginStatus?.().then(status=>{if(live)setAccountLogin(status);}).catch(()=>{});
    bridge.listInventoryOperations?.().then(items=>{if(live)setInventoryOperations(old=>{
      const next=Object.fromEntries(items.map(item=>[item.operationId,item]));
      for(const [id,operation] of Object.entries(old)){
        if(!next[id]||(operation.updatedAt||operation.at||'')>=(next[id].updatedAt||''))next[id]=operation;
      }
      return next;
    });}).catch(error=>{if(live)setNotice(error.message);});
    const unsubscribe = bridge.onEvent((event) => {
      if (!live) return;
      if(event.type==='token-converter'){currentConverter.current=event.status;setConverter(event.status);if(event.accountId){const matches=(event.status?.rows||[]).filter(r=>event.operationId?r.operationId===event.operationId:r.accountId===event.accountId);const row=matches.length===1?matches[0]:null;if(row&&['confirmed','cancelled','stopped','reviewed'].includes(row.state)){refreshAccount(row.accountId);if(row.destinationAccountId)refreshAccount(row.destinationAccountId);}}}
      if(event.type==='account-session')setAccounts(old=>old.map(account=>account.partition===event.partition?{...account,session:event.session}:account));
      if(event.type==='account-login-progress'){
        setAccountLogin(event.status);
        if(['complete','paused','stopped'].includes(event.status.phase)){bridge.listAccounts().then(items=>{if(live)setAccounts(items);}).catch(()=>{});setNotice(event.status.message||`${event.status.connected||0} logins concluídos · ${event.status.alreadyConnected||0} já ligados.`);}
      }
      if(event.type==='progression'&&['completed','stopped','failed','unconfirmed'].includes(event.state)&&event.accountId){refreshAccount(event.accountId);setInventoryRevision(old=>({...old,[event.accountId]:(old[event.accountId]||0)+1}));}
      if(event.type==='storage-management'&&event.accountId){setInventoryRevision(old=>({...old,[event.accountId]:(old[event.accountId]||0)+1}));}
      if(event.type==='inventory-action'){setInventoryOperations(old=>{
        const previous=old[event.operationId];
        return previous&&(previous.updatedAt||previous.at||'')>(event.updatedAt||event.at||'')
          ?old:{...old,[event.operationId]:event};
      });if(event.state!=='running'||event.stage==='withdrawn'){const ids=[event.accountId,event.destinationAccountId].filter(Boolean);setInventoryRevision(old=>{const next={...old};for(const id of ids)next[id]=(next[id]||0)+1;return next;});for(const id of ids)refreshAccount(id);}}
      if (event.status) { if (Object.hasOwn(event.status, 'opened')) setOpening(event.status); else if (Array.isArray(event.status.accounts)) {currentFarm.current=event.status;setFarmStatus(event.status);} }
      if (event.type==='farm-started'||event.type==='cooldown'||(event.type==='token-converter'&&['preparing','revalidating','running','stopping'].includes(event.status?.phase))) refreshQueue.current?.stop();
      if(event.type==='request'&&event.snapshot&&event.accountId){
        snapshotVersion.current[event.accountId]=(snapshotVersion.current[event.accountId]||0)+1;
        setSnapshots(old=>({...old,[event.accountId]:observedSnapshot(event.snapshot,Date.parse(event.at)||Date.now())}));
      } else if (!event.remote&&(['request', 'vault', 'open', 'conversion', 'game'].includes(event.type) || (event.type === 'socket-game-update' && event.event === 'userstats')) && !(currentFarm.current.budget?.cooldownUntil>Date.now())) refreshAccount(event.accountId || event.account?.id);
      if(event.type==='account-renamed')setAccounts(old=>old.map(account=>account.id===event.account.id?{...account,...event.account}:account));
      if(event.type==='account-added')bridge.listAccounts().then(items=>{if(live)setAccounts(items);}).catch(()=>{});
      if (['request', 'vault', 'open', 'conversion', 'opening-item', 'game', 'cooldown', 'budget-wait', 'farm-started', 'farm-finished', 'open-started', 'open-finished', 'account-error', 'needs-login', 'farm-stopping','inventory-action','progression'].includes(event.type)) setEvents((old) => [event, ...old].slice(0, 150));
      if (event.type === 'notice' || event.type === 'run-error') setNotice(event.message);
    });
    refreshQueue.current = createAccountRefreshQueue({ refreshAccount:id=>{
      if(refreshSource.current==='automatic'){
        const account=latest.current.accountsById.get(id);
        if(!account||!planOverviewRefresh({accounts:[account],snapshots:latest.current.snapshots}).targets.length)return;
      }
      return refreshAccount(id,{throwOnError:true});
    },delayMs:0,maxConcurrent:4,continueOnError:true,maxConsecutiveErrors:3,onProgress:status=>{if(live)setRefreshStatus(status);} });
    return () => { live = false; mounted.current=false; unsubscribe(); poller.stop();document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);refreshQueue.current?.stop(); };
  }, [bridge,refreshAccount]);

  useEffect(()=>{if(!loading)statusPoller.current?.schedule();},[farmStatus.phase,converter.phase,opening.phase,loading]);
  const needsClock=running||['running','stopping'].includes(accountLogin.phase)||Math.max(refreshStatus.retryAt||0,farmStatus.budget?.cooldownUntil||0,farmStatus.budget?.waitUntil||0,opening.cooldownUntil||0,converter.retryAt||0)>Date.now();
  useEffect(()=>{
    let timer,expiryTimer;
    const update=()=>{
      clearInterval(timer);clearTimeout(expiryTimer);
      const now=Date.now();setTick(now);
      if(document.visibilityState!=='visible')return;
      if(needsClock)timer=setInterval(()=>setTick(Date.now()),1000);
      else {
        const expiries=Object.values(snapshots).map(snapshot=>Date.parse(snapshot?.observedAt)+300001).filter(expiry=>Number.isFinite(expiry)&&expiry>now);
        if(expiries.length)expiryTimer=setTimeout(update,Math.min(...expiries)-now);
      }
    };
    update();document.addEventListener('visibilitychange',update);
    return()=>{clearInterval(timer);clearTimeout(expiryTimer);document.removeEventListener('visibilitychange',update);};
  },[needsClock,snapshots]);

  const readings = useMemo(() => overviewReadings(accounts,snapshots), [accounts, snapshots]);
  const totals = useMemo(() => ({connected:readings.connected,cases:readings.fields.casesTotal.value,money:readings.fields.money.value,tokens:readings.fields.tokens.value}), [readings]);
  const pendingLoginIds = useMemo(() => getPendingLoginIds(accounts,snapshots,farmStatus.accounts), [accounts,snapshots,farmStatus.accounts]);
  const caseNames = useMemo(()=>{const names={};for(const snapshot of Object.values(snapshots))for(const item of snapshot?.cases||[])names[item.id]=item.name;return names;},[snapshots]);
  const awards = useMemo(() => groupCaseAwards(events,caseNames), [events,caseNames]);
  const openingCooldown = Math.max(0, Math.ceil(((opening.cooldownUntil || 0) - tick) / 1000));
  const priceValid = maxPrice !== '' && Number.isFinite(Number(maxPrice)) && Number(maxPrice) >= 0 && Number(maxPrice) <= 1000;
  const caseChoices = useMemo(() => commonCaseChoices(selectedIds,snapshots), [selectedIds, snapshots]);

  async function invokeFarm(action) {
    if(farmOperation.current)return;
    farmOperation.current=true;setFarmPending(true);
    try{return await action();}
    catch(error){setNotice(error.message||String(error));}
    finally{farmOperation.current=false;setFarmPending(false);}
  }
  async function stopFarm() {
    return invokeFarm(async()=>{const status=await bridge.farmStop();setFarmStatus(status);currentFarm.current=status;return status;});
  }
  async function addAccount(labelValue) {
    const label=String(labelValue||''); if (!bridge || !label.trim()) return;
    setBusy(true); setNotice('Conclui o login na janela temporária. Ela fecha após a validação.');
    try { const account = await bridge.openLogin(label.trim()); if (account) { setAccounts(await bridge.listAccounts()); setSelectedIds((old) => [...old, account.id]); setLabel(''); setNotice(`${account.label} ligada com sucesso.`); } else setNotice('Login cancelado; nenhuma conta foi guardada.'); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function importAccounts() {
    if (!bridge?.importAccounts || busy || running) return;
    setBusy(true); setNotice('Escolhe o JSON descarregado pelo ajudante.');
    try {
      const result = await bridge.importAccounts();
      if (!result) { setNotice('Importação cancelada.'); return; }
      setAccounts(await bridge.listAccounts());
      setSelectedIds(old => [...new Set([...old, ...result.accounts.map(account => account.id)])]);
      setFarmStatus(await bridge.farmStatus());
      setNotice(`${result.added} contas importadas · ${result.updated} atualizadas. Sessões existentes conservadas.`);
    } catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function runAccountLogins(ids) {
    if (!bridge?.connectImportedAccounts) return;
    const result = await bridge.connectImportedAccounts(ids);
    setAccountLogin(result); setFarmStatus(await bridge.farmStatus());
    setNotice(result.phase==='running'?'A entrar nas contas sem sessão guardada…':result.phase==='complete' ? `${result.connected} logins concluídos · ${result.alreadyConnected} já ligados · ${result.withoutPassword} sem palavra-passe.` : `${result.phase==='stopped'?'Logins parados':'Logins em pausa'}${result.label?` em ${result.label}`:''}. ${result.message||''}`);
  }
  async function connectImportedAccounts() {
    if (!bridge?.connectImportedAccounts || busy || running) return;
    setBusy(true);setNotice('A iniciar os logins automáticos…');
    try { await runAccountLogins(); } catch(error) { setNotice(error.message||String(error)); } finally { setBusy(false); }
  }
  async function connectPendingAccounts(ids=pendingLoginIds) {
    if (!bridge?.connectImportedAccounts || busy || running || !pendingLoginIds.length) return;
    setBusy(true);setNotice('A entrar nas contas que ainda não estão ligadas…');
    try { const targets=pendingLoginIds.filter(id=>ids.includes(id));if(targets.length)await runAccountLogins(targets); } catch(error) { setNotice(error.message||String(error)); } finally { setBusy(false); }
  }
  async function stopAccountLogins() {
    try { setAccountLogin(await bridge.stopAccountLogins()); } catch(error) { setNotice(error.message||String(error)); }
  }
  async function connectAccount(account, options) {
    if (!bridge?.connectAccount || busy || running) return;
    setBusy(true); setNotice(`A entrar em ${account.label}…`);
    try {
      const connected = await bridge.connectAccount(account.id, options);
      if (connected) { setFarmStatus(await bridge.farmStatus());setAccounts(await bridge.listAccounts());setNotice(`${account.label} ligada com sucesso.`); }
      else setNotice('Login cancelado; a conta importada continua guardada.');
    } catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function removeAccount(account) {
    if (!bridge || running || !window.confirm(t(`Remover ${account.label} e terminar a sessão guardada?`))) return;
    setBusy(true); try { await bridge.removeAccount(account.id); setAccounts((old) => old.filter((item) => item.id !== account.id)); setSelectedIds((old) => old.filter((id) => id !== account.id)); setBettingIds((old)=>old.filter(id=>id!==account.id)); setSnapshots((old) => { const next = { ...old }; delete next[account.id]; return next; }); setNotice(`${account.label} removida.`); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function startOpening(testOnce = false,itemRules=[],options={}) {
    if (!bridge) return;
    setBusy(true); setNotice('');
    const convertItems=!itemRules.length&&(options.convert??convert);
    try { setOpening(await bridge.startOpening({ accountIds: selectedIds, caseId, convert:convertItems, conversionMode, maxPrice: convertItems?Number(maxPrice):0, testOnce,itemRules,maxCasesPerAccount:options.maxCasesPerAccount })); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function stopOpening() { try { setOpening(await bridge.stopOpening()); } catch (error) { setNotice(error.message || String(error)); } }
  async function exportResults() { try { const file = await bridge.exportRun(); if (file) setNotice(`Relatório guardado em ${file}`); } catch (error) { setNotice(error.message || String(error)); } }

  async function workspaceCommand(action,payload){
    const result=await bridge.accountWorkspaceCommand(action,payload);
    if(!['selectGroup','loadProfile'].includes(action))setAccountWorkspace(result);
    if(action==='renameAccount')setAccounts(await bridge.listAccounts());
    return result;
  }
  function applyOperationProfile(config){
    if(config.targetCase)setCaseId(config.targetCase);
    if(config.itemRules){setProfileRules(old=>({...old,[config.targetCase||caseId]:config.itemRules}));setConvert(false);}
    setLoadedOperationProfile({config,loadedAt:Date.now()});
    setNotice('Perfil local carregado. Revê as regras em Abertura e aplica os modos em Automação. Nenhuma operação foi iniciada.');
  }
  const rulesForProfile=profileRules[caseId]||[];
  const operationProfileConfig={farm:loadedOperationProfile?.config.farm||{case:true,money:true,vault:true},targetCase:caseId||null,itemRules:toOperationProfileRules(Array.isArray(rulesForProfile)?rulesForProfile:Object.entries(rulesForProfile).map(([name,r])=>({name,...r}))),destinations:loadedOperationProfile?.config.destinations||[]};
  const form={label,caseId,convert,conversionMode,maxPrice};
  function setForm(patch){
    const next=typeof patch==='function'?patch(form):patch;
    for(const [key,setter] of Object.entries({label:setLabel,caseId:setCaseId,convert:setConvert,conversionMode:setConversionMode,maxPrice:setMaxPrice}))if(Object.hasOwn(next,key))setter(next[key]);
  }
  return {now:tick,loadError,refreshStatus,autoRefreshPaused,readings,extensionCapabilities,accountWorkspace,operationProfileConfig,loadedOperationProfile,setProfileRules,bridge,converter,setConverter,accountLogin,inventoryOperations,inventoryRevision,accounts,snapshots,pendingLoginIds,selectedIds,setSelectedIds,bettingIds,setBettingIds,blackjackStats,setBlackjackStats,farmStatus,opening,events,awards,totals,caseChoices,loading,notice,setNotice,busy,farmPending,running,openingCooldown,priceValid,form,setForm,actions:{workspaceCommand,applyOperationProfile,invokeFarm,stopFarm,addAccount,importAccounts,connectImportedAccounts,connectPendingAccounts,stopAccountLogins,connectAccount,removeAccount,refreshAccount,refreshAccounts,stopRefresh,stopAutomaticRefresh,startOpening,stopOpening,exportResults}};
}
