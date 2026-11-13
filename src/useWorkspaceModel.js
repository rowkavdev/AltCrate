import {t} from './language.js';
import {toOperationProfileRules} from './operationProfile.js';
import {useEffect,useMemo,useRef,useState} from 'react';
import {commonCaseChoices} from './workspaceViewModel.js';
import {groupCaseAwards} from './caseAwards.js';
import {createAccountRefreshQueue} from './accountRefresh.js';
export function calculateAccountTotals(accounts,snapshots){
  return accounts.reduce((sum,account)=>{
    const snapshot=snapshots[account.id];
    if(snapshot&&!snapshot.error){
      sum.connected++;
      sum.cases+=snapshot.casesTotal||0;
      sum.money+=snapshot.money||0;
      sum.tokens+=Number.isFinite(snapshot.tokens)?snapshot.tokens:0;
    }
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
  const [snapshots, setSnapshots] = useState({});
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
  const currentFarm=useRef(farmStatus);
  currentFarm.current=farmStatus;
  const running = ['running', 'stopping'].includes(farmStatus.phase) || ['running', 'stopping'].includes(opening.phase)||['preparing','running','stopping'].includes(converter.phase);

  async function refreshAccount(id) {
    if (!bridge || !id) return;
    const version = (snapshotVersion.current[id] || 0) + 1;
    snapshotVersion.current[id] = version;
    try { const snapshot = await bridge.refreshAccount(id); if (snapshotVersion.current[id] === version) setSnapshots((old) => ({ ...old, [id]: snapshot })); }
    catch (error) { if (snapshotVersion.current[id] === version) setSnapshots((old) => ({ ...old, [id]: { error: String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '') } })); }
  }

  useEffect(()=>{if(farmStatus?.execution?.kind==='server'&&farmStatus.observations)setSnapshots(old=>({...old,...farmStatus.observations}));},[farmStatus.observations]);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    Promise.all([bridge.listAccounts(), bridge.farmStatus(), bridge.getOpeningStatus()]).then(([items, status, openStatus]) => { if (!live) return; setAccounts(items); setSelectedIds(status.phase === 'running' ? status.accounts.filter(item=>item.selected).map(item=>item.id) : items.map(item=>item.id)); setFarmStatus(status); currentFarm.current=status; setOpening(openStatus); if(!['running','stopping'].includes(status.phase)&&!(status.budget?.cooldownUntil>Date.now()))refreshQueue.current?.run(items); }).catch((error) => {if(live)setNotice(error.message);}).finally(()=>{if(live)setLoading(false);});
    bridge.extensionCapabilities?.().then(value=>{if(live)setExtensionCapabilities(value);}).catch(error=>{if(live)setNotice(error.message);});
    bridge.readAccountWorkspace?.().then(value=>{if(live)setAccountWorkspace(value);}).catch(error=>{if(live)setNotice(error.message);});
    bridge.getTokenConverterStatus?.().then(status=>{if(live)setConverter(status);}).catch(()=>{});
    bridge.accountLoginStatus?.().then(status=>{if(live)setAccountLogin(status);}).catch(()=>{});
    bridge.listInventoryOperations?.().then(items=>{if(live)setInventoryOperations(Object.fromEntries(items.map(item=>[item.operationId,item])));}).catch(error=>{if(live)setNotice(error.message);});
    const unsubscribe = bridge.onEvent((event) => {
      if (!live) return;
      if(event.type==='token-converter'){setConverter(event.status);if(event.accountId){const row=event.status?.rows?.find(r=>r.accountId===event.accountId);if(row&&['confirmed','cancelled','stopped','reviewed'].includes(row.state)){refreshAccount(event.accountId);if(event.destinationAccountId)refreshAccount(event.destinationAccountId);}}}
      if(event.type==='account-login-progress')setAccountLogin(event.status);
      if(event.type==='progression'&&['completed','stopped','failed','unconfirmed'].includes(event.state)&&event.accountId){refreshAccount(event.accountId);setInventoryRevision(old=>({...old,[event.accountId]:(old[event.accountId]||0)+1}));}
      if(event.type==='storage-management'&&event.accountId){setInventoryRevision(old=>({...old,[event.accountId]:(old[event.accountId]||0)+1}));}
      if(event.type==='inventory-action'){setInventoryOperations(old=>({...old,[event.operationId]:event}));if(event.state!=='running'||event.stage==='withdrawn'){const ids=[event.accountId,event.destinationAccountId].filter(Boolean);setInventoryRevision(old=>{const next={...old};for(const id of ids)next[id]=(next[id]||0)+1;return next;});for(const id of ids)refreshAccount(id);}}
      if (event.status) { if (Object.hasOwn(event.status, 'opened')) setOpening(event.status); else if (Array.isArray(event.status.accounts)) {currentFarm.current=event.status;setFarmStatus(event.status);} }
      if (event.type==='farm-started'||event.type==='cooldown') refreshQueue.current?.stop();
      if(event.type==='request'&&event.snapshot&&event.accountId){
        snapshotVersion.current[event.accountId]=(snapshotVersion.current[event.accountId]||0)+1;
        setSnapshots(old=>({...old,[event.accountId]:event.snapshot}));
      } else if (!event.remote&&(['request', 'vault', 'open', 'conversion', 'game', 'account-added'].includes(event.type) || (event.type === 'socket-game-update' && event.event === 'userstats')) && !(currentFarm.current.budget?.cooldownUntil>Date.now())) refreshAccount(event.accountId || event.account?.id);
      if (['request', 'vault', 'open', 'conversion', 'opening-item', 'game', 'cooldown', 'budget-wait', 'farm-started', 'farm-finished', 'open-started', 'open-finished', 'account-error', 'needs-login', 'farm-stopping','inventory-action','progression'].includes(event.type)) setEvents((old) => [event, ...old].slice(0, 150));
      if (event.type === 'notice' || event.type === 'run-error') setNotice(event.message);
    });
    refreshQueue.current = createAccountRefreshQueue({ refreshAccount });
    const timer = setInterval(() => setTick(Date.now()), 1000);
    const statusTimer = setInterval(() => { if (document.visibilityState === 'visible') {bridge.farmStatus().then((status) => { if (live) setFarmStatus(status); }).catch(() => {});bridge.getTokenConverterStatus?.().then(status=>{if(live)setConverter(status);}).catch(()=>{});} }, 2000);
    return () => { live = false; unsubscribe(); clearInterval(timer); clearInterval(statusTimer); refreshQueue.current?.stop(); };
  }, []);

  useEffect(() => {
    if (!bridge || !accounts.length) return;
    const refreshVisible = () => { const farm=currentFarm.current;if (!['preparing','running','stopping'].includes(currentConverter.current.phase)&&document.visibilityState === 'visible'&&!['running','stopping'].includes(farm.phase)&&!(farm.budget?.cooldownUntil>Date.now())) refreshQueue.current?.run(accounts); };
    const timer = setInterval(refreshVisible, 30000);
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshVisible(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [accounts.map((account) => account.id).join('|')]);

  const totals = useMemo(() => calculateAccountTotals(accounts,snapshots), [accounts, snapshots]);
  const awards = useMemo(() => groupCaseAwards(events, Object.fromEntries(Object.values(snapshots).flatMap((snapshot) => (snapshot?.cases || []).map((item) => [item.id, item.name])))), [events, snapshots]);
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
    try { const account = await bridge.openLogin(label.trim()); if (account) { setAccounts((old) => [...old, account]); setSelectedIds((old) => [...old, account.id]); setLabel(''); setNotice(`${account.label} ligada com sucesso.`); await refreshAccount(account.id); } else setNotice('Login cancelado; nenhuma conta foi guardada.'); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function importAccounts() {
    if (!bridge?.importAccounts || busy || running) return;
    setBusy(true); setNotice('Escolhe o JSON descarregado pelo ajudante.');
    try {
      const result = await bridge.importAccounts();
      if (!result) { setNotice('Importação cancelada.'); return; }
      setAccounts(result.accounts);
      setSelectedIds(old => [...new Set([...old, ...result.accounts.map(account => account.id)])]);
      setFarmStatus(await bridge.farmStatus());
      setNotice(`${result.added} contas importadas · ${result.updated} atualizadas${result.withoutPassword ? ` · ${result.withoutPassword} sem palavra-passe` : ''}. A iniciar os logins automáticos…`);
      refreshQueue.current?.run(result.accounts);
      await runAccountLogins();
    } catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function runAccountLogins() {
    if (!bridge?.connectImportedAccounts) return;
    const result = await bridge.connectImportedAccounts();
    setAccountLogin(result); setFarmStatus(await bridge.farmStatus());
    setNotice(result.phase==='complete' ? `${result.connected} logins concluídos · ${result.alreadyConnected} já ligados · ${result.withoutPassword} sem palavra-passe.` : `${result.phase==='stopped'?'Logins parados':'Logins em pausa'}${result.label?` em ${result.label}`:''}. ${result.message||''}`);
  }
  async function connectImportedAccounts() {
    if (!bridge?.connectImportedAccounts || busy || running) return;
    setBusy(true);setNotice('A iniciar os logins automáticos…');
    try { await runAccountLogins(); } catch(error) { setNotice(error.message||String(error)); } finally { setBusy(false); }
  }
  async function stopAccountLogins() {
    try { setAccountLogin(await bridge.stopAccountLogins()); } catch(error) { setNotice(error.message||String(error)); }
  }
  async function connectAccount(account) {
    if (!bridge?.connectAccount || busy || running) return;
    setBusy(true); setNotice(`A entrar em ${account.label}…`);
    try {
      const connected = await bridge.connectAccount(account.id);
      if (connected) { setFarmStatus(await bridge.farmStatus()); await refreshAccount(account.id); setNotice(`${account.label} ligada com sucesso.`); }
      else setNotice('Login cancelado; a conta importada continua guardada.');
    } catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function removeAccount(account) {
    if (!bridge || running || !window.confirm(t(`Remover ${account.label} e terminar a sessão guardada?`))) return;
    setBusy(true); try { await bridge.removeAccount(account.id); setAccounts((old) => old.filter((item) => item.id !== account.id)); setSelectedIds((old) => old.filter((id) => id !== account.id)); setBettingIds((old)=>old.filter(id=>id!==account.id)); setSnapshots((old) => { const next = { ...old }; delete next[account.id]; return next; }); setNotice(`${account.label} removida.`); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function startOpening(testOnce = false,itemRules=[]) {
    if (!bridge) return;
    setBusy(true); setNotice('');
    try { setOpening(await bridge.startOpening({ accountIds: selectedIds, caseId, convert:itemRules.length?false:convert, conversionMode, maxPrice: convert&&!itemRules.length?Number(maxPrice):0, testOnce,itemRules })); }
    catch (error) { setNotice(error.message || String(error)); } finally { setBusy(false); }
  }
  async function stopOpening() { try { setOpening(await bridge.stopOpening()); } catch (error) { setNotice(error.message || String(error)); } }
  async function exportResults() { try { const file = await bridge.exportRun(); if (file) setNotice(`Relatório guardado em ${file}`); } catch (error) { setNotice(error.message || String(error)); } }

  async function workspaceCommand(action,payload){
    const result=await bridge.accountWorkspaceCommand(action,payload);
    if(!['selectGroup','loadProfile'].includes(action))setAccountWorkspace(result);
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
  return {extensionCapabilities,accountWorkspace,operationProfileConfig,loadedOperationProfile,setProfileRules,bridge,converter,setConverter,accountLogin,inventoryOperations,inventoryRevision,accounts,snapshots,selectedIds,setSelectedIds,bettingIds,setBettingIds,blackjackStats,setBlackjackStats,farmStatus,opening,events,awards,totals,caseChoices,loading,notice,setNotice,busy,farmPending,running,openingCooldown,priceValid,form,setForm,actions:{workspaceCommand,applyOperationProfile,invokeFarm,stopFarm,addAccount,importAccounts,connectImportedAccounts,stopAccountLogins,connectAccount,removeAccount,refreshAccount,startOpening,stopOpening,exportResults}};
}
