const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain, shell, session, dialog, net, safeStorage } = require('electron');
const { WebSocket: EngineWebSocket } = require('engine.io-client');
const { loginFillScript, loginStepScript, createLoginQueue, createLoginProbe } = require('./accountLogin.cjs');
const { createAccountRegistry, MAX_ACCOUNTS } = require('./accounts.cjs');
const { createCaseApi } = require('./api.cjs');
const {createInventoryReader}=require('./inventoryView.cjs');
const {createStorageManagement,registerStorageManagementIpc}=require('./storageManagement.cjs');
const {createStorageReader}=require('./storageView.cjs');
const {createStorageDeposit}=require('./storageDeposit.cjs');
const {createItemLocator}=require('./inventoryItemLocator.cjs');
const {createInventoryOperationStore}=require('./inventoryOperationStore.cjs');
const {createInventoryActions}=require('./inventoryActions.cjs');
const {createInventoryTransfers}=require('./inventoryTransfers.cjs');
const {createTradeTransport}=require('./tradeTransport.cjs');
const {createTokenConverter}=require('./tokenConverter.cjs');
const {registerTokenConverterIpc}=require('./tokenConverterIpc.cjs');
const {createOperationInterlock}=require('./operationInterlock.cjs');
const {registerInventoryActionsIpc}=require('./inventoryActionsIpc.cjs');
const { createFarmOrchestrator } = require('./farmOrchestrator.cjs');
const { createFarmNetwork } = require('./farmNetwork.cjs');
const { createRemoteFarm } = require('./remoteFarm.cjs');
const { createProgressionService } = require('./progression.cjs');
const {createAppPreferences}=require('./appPreferences.cjs');
const {createJsonStore}=require('./jsonStore.cjs');
const {createAccountWorkspace}=require('./accountWorkspace.cjs');
const {registerAccountWorkspaceIpc}=require('./accountWorkspaceIpc.cjs');
const {createProgressionBatch,registerProgressionBatchIpc}=require('./progressionBatch.cjs');
const {createInventoryBatch,registerInventoryBatchIpc}=require('./inventoryBatch.cjs');
const {createOperationHistory}=require('./operationHistory.cjs');
const {createRequestCoordinator}=require('./requestCoordinator.cjs');
const {listExtensionCapabilities}=require('./extensionCapabilities.cjs');
const {createCoordinatedTransport}=require('./coordinatedTransport.cjs');
const { registerProgressionIpc } = require('./progressionIpc.cjs');
const { createProgressionGuard,createProgressionEntryGuard,createProgressionAccountGuard } = require('./progressionGuard.cjs');
const { createServerSsh } = require('./serverFarmSsh.cjs');
const {createServerDesktop}=require('./serverFarmDesktop.cjs');
const {createServerSetup}=require('./serverFarmSetup.cjs');
const {probeServerIdentity,trustServerIdentity}=require('./serverFarmProfile.cjs');
const {withRouteBudgets}=require('./serverFarmRoutes.cjs');
const { createCaseShowcase } = require('./caseShowcase.cjs');
const { registerFarmIpc } = require('./farmIpc.cjs');
const { createOpenScheduler } = require('./openScheduler.cjs');
const {createOpeningPolicy,validateOpeningRules,itemRankingIdentity}=require('./openingPolicy.cjs');
const {createItemRanking}=require('./itemRanking.cjs');
const { createClickCoordinator } = require('./clickCoordinator.cjs');
const { createAccountQueue } = require('./accountQueue.cjs');
const { createAccountSnapshots } = require('./accountSnapshots.cjs');
const { createGames } = require('./games.cjs');
const { createSocketGames, ROOMS } = require('./socketGames.cjs');
const { createReport, safeEvent } = require('./export.cjs');
const { createLocalAi } = require('./localAi.cjs');

let mainWindow;
let accounts;
let farm;
let farmControls;
let farmNetwork;
let openScheduler;
let games;
let socketGames;
let snapshots;
let inventoryActions,storageManagement;
let tokenConverter;
let localAi;
let evidence = [];
let operationHistory,inventoryBatch,inventoryBatchBusy=0,progressionBatch;
const requestWork=createRequestCoordinator();
const ORIGIN = 'https://case-clicker.com';
const USER_DATA_PATH = process.env.CASE_CLICKER_TEST_DATA_DIR || path.join(app.getPath('appData'), 'case-clicker-mac-dashboard');
fsSync.mkdirSync(USER_DATA_PATH, { recursive: true, mode: 0o700 });
app.setPath('userData', USER_DATA_PATH);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

function emit(payload) {
  operationHistory?.append(payload).catch(()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('dashboard:event',{type:'notice',message:'Não foi possível guardar o histórico local. Verifica o espaço em disco.'});});
  snapshots?.invalidateForEvent(payload);
  if (['request', 'vault', 'open', 'conversion', 'opening-item', 'game', 'cooldown', 'budget-wait', 'needs-login', 'account-error', 'farm-started', 'farm-finished', 'open-started', 'open-finished','inventory-action','progression'].includes(payload.type)) {
    evidence.push(safeEvent(payload));
    if (evidence.length > 5000) evidence.shift();
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dashboard:event', payload);
}

function getApi(account) {
  return createCaseApi((endpoint, init) => farmNetwork.fetch(account, endpoint, init),{
    publicFetcher:(endpoint,init)=>session.fromPartition(account.partition).fetch(ORIGIN+endpoint,init),
  });
}
function converterGuard() {
  if(tokenConverter?.active()||tokenConverter?.status().phase==='blocked')throw Error('Para o conversor e resolve a operação pendente antes de iniciar outra operação.');
}
let progression,progressionBusy=0;
const baseProgressionWriteGuard=createProgressionGuard({converterGuard,getService:()=>progression,getBusy:()=>progressionBusy});
const progressionWriteGuard=()=>{baseProgressionWriteGuard();if(storageManagement?.hasPending()||inventoryBatchBusy||inventoryBatch?.hasPending?.()||progressionBatch?.active())throw Error('Há um lote em curso ou por confirmar. Para ou verifica o lote antes de iniciar outra operação.');};
const progressionAccountGuard=createProgressionAccountGuard({getBusy:()=>progressionBusy+inventoryBatchBusy});
const otherOperations=createOperationInterlock(progressionWriteGuard);

function storage() {
  const file = path.join(app.getPath('userData'), 'accounts.json');
  return {
    async load() {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async save(value) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
      await fs.rename(temp, file);
    },
  };
}

function rateStorage() {
  const file = path.join(app.getPath('userData'), 'rate-state.json');
  return {
    async load() {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
    async save(value) {
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(temp, file);
    },
  };
}

function farmStorage() {
  const file = path.join(app.getPath('userData'), 'farm-state.json');
  return {
    async load() {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
    async save(value) {
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(temp, file);
    },
  };
}

let accountOperation = false;
let accountLogins;
const credentialProtector = {
  seal(value) {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw Error('A proteção de palavras-passe do sistema não está disponível.');
    return safeStorage.encryptString(value).toString('base64');
  },
  open(value) {
    if (!safeStorage.isEncryptionAvailable()) throw Error('Não foi possível desbloquear a palavra-passe guardada.');
    try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
    catch { throw Error('Não foi possível desbloquear a palavra-passe guardada. Importa novamente o JSON.'); }
  },
};
async function accountTask(event, action) {
  if (event.sender !== mainWindow?.webContents) throw Error('Pedido de contas inválido.');
  converterGuard();
  progressionAccountGuard();
  if(storageManagement?.hasPending()||inventoryBatch?.hasPending()||progressionBatch?.active())throw Error('Verifica os lotes pendentes antes de alterar sessões.');
  if (accountOperation) throw Error('Já existe uma operação de contas em curso.');
  if (['running', 'stopping'].includes(farm.status().phase) || ['running', 'stopping'].includes(openScheduler.status().phase)) throw Error('Para a execução antes de alterar contas.');
  accountOperation = true;
  try { return await action(); } finally { accountOperation = false; }
}
async function importAccountFile() {
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Importar contas do JSON', properties: ['openFile'], filters: [{ name: 'Contas JSON', extensions: ['json'] }] });
  if (choice.canceled || !choice.filePaths[0]) return null;
  const file = choice.filePaths[0], info = await fs.stat(file);
  if (!info.isFile() || info.size > 1024 * 1024) throw Error('Escolhe um ficheiro JSON até 1 MB.');
  let value;
  try { value = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw Error('O ficheiro não contém JSON válido. Escolhe o ficheiro completo descarregado pelo ajudante.'); }
  const result = await accounts.importAccounts(value, credentialProtector);
  let serverEnabled=false;
  try{serverEnabled=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'farm-server.json'),'utf8')).enabled===true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!serverEnabled)await farmNetwork.ready(await accounts.list());
  await farm.syncAccounts(await accounts.list());
  return result;
}
async function loginAccount(label, existingAccount = null, { signal } = {}) {
  const name = String(label || '').trim();
  if (!name || name.length > 40) throw new Error('Escreve um nome local para a conta');
  const existing = await accounts.list();
  if (!existingAccount && existing.length >= MAX_ACCOUNTS) throw new Error(`A app admite até ${MAX_ACCOUNTS} contas`);
  if (!existingAccount && existing.some((account) => account.label.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('Já existe uma conta com esse nome');
  }
  const partition = existingAccount?.partition || `persist:caseclicker-${randomUUID()}`;
  const ses = session.fromPartition(partition);
  let credentials = existingAccount ? await accounts.credentials(existingAccount.id, credentialProtector) : null;
  const loginWindow = new BrowserWindow({
    width: 1050, height: 800, title: `Entrar: ${name}`, parent: mainWindow,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  if (credentials?.email) {
    loginWindow.webContents.on('did-finish-load', async () => {
      if (!credentials || loginWindow.isDestroyed()) return;
      const url = new URL(loginWindow.webContents.getURL());
      if (url.origin !== ORIGIN || url.pathname !== '/auth/login') return;
      try {
        for (let attempt = 0; attempt < 15 && !loginWindow.isDestroyed() && credentials; attempt++) {
          if (await loginWindow.webContents.executeJavaScript(loginFillScript(credentials))) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch { /* A closed or navigating login window is handled below. */ }
    });
  }
  try { await loginWindow.loadURL(`${ORIGIN}${existingAccount ? '/auth/login' : '/'}`); }
  catch { credentials = null; if (!loginWindow.isDestroyed()) loginWindow.close(); throw Error('Não foi possível abrir o login. Tenta novamente.'); }
  if (signal?.aborted || loginWindow.isDestroyed()) { credentials = null; if (!loginWindow.isDestroyed()) loginWindow.close(); return null; }
  const automatic = Boolean(credentials?.password);
  emit({ type: 'notice', message: automatic ? `A entrar automaticamente em ${name}…` : `Conclui o login de ${name} na janela aberta.` });
  return new Promise((resolve, reject) => {
    let finished = false;
    let checking = false, challengeNotice = false;
    const startedAt = Date.now();
    const onAbort = () => { if (!loginWindow.isDestroyed()) loginWindow.close(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const probe = createLoginProbe({
      automatic,
      step: submit => loginWindow.webContents.executeJavaScript(loginStepScript(submit)),
      validate: () => ses.fetch(`${ORIGIN}/api/me`, { method: 'GET', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) }),
    });
    const checkLogin = async (force = false) => {
      if (finished || checking || loginWindow.isDestroyed()) return;
      checking = true;
      try {
        if (automatic && Date.now() - startedAt > 120000) throw Error('Login não concluído em 2 minutos. Completa a verificação do site e tenta novamente.');
        const { step, response } = await probe.check({ force });
        if (step === 'failed') throw Error('O site recusou o login. Verifica a palavra-passe desta conta antes de continuar.');
        if (step === 'challenge' && !challengeNotice && Date.now() - startedAt > 8000) {
          challengeNotice = true;
          emit({ type: 'notice', message: `Completa a verificação do site na janela de ${name}. O automático aguarda nesta conta.` });
        }
        if (!response || finished || loginWindow.isDestroyed()) return;
        if (response.ok) {
          const me = await response.json();
          if (finished || loginWindow.isDestroyed()) return;
          if (Number.isFinite(Number(me.money)) && typeof me.role === 'string') {
            if (existingAccount?.email && typeof me.email === 'string' && me.email.toLowerCase() !== existingAccount.email) throw Error('O site iniciou sessão com outro email.');
            const account = existingAccount || await accounts.add(name, partition);
            await farmNetwork.ready(await accounts.list());
            await farm?.syncAccounts(await accounts.list());
            if (existingAccount && farm.status().accounts.find(item => item.id === account.id)?.needsLogin) {
              const wasPaused = farm.status().accounts.find(item => item.id === account.id)?.paused;
              await farm.resume(account.id);
              if (wasPaused) await farm.pause(account.id);
            }
            finished = true;
            cleanupLogin();
            credentials = null;
            loginWindow.close();
            emit({ type: 'account-added', account });
            resolve(account);
            return;
          }
        }
        if (finished || loginWindow.isDestroyed()) return;
        if (response.status === 429) throw Error('O site limitou os logins. Aguarda antes de continuar.');
        if (response.status >= 500) throw Error('O site está indisponível. Tenta os logins mais tarde.');
      } catch (error) {
        if (!finished && (automatic || error.message?.includes('Já existe'))) {
          finished = true;
          cleanupLogin();
          credentials = null;
          loginWindow.close();
          reject(new Error(error.message?.includes('fetch') || error.name === 'TimeoutError' ? 'Não foi possível contactar o site. Tenta novamente.' : error.message));
        }
      } finally { checking = false; }
    };
    const timer = setInterval(checkLogin, 250);
    const onNavigate = () => { void checkLogin(true); };
    loginWindow.webContents.on('did-navigate', onNavigate);
    loginWindow.webContents.on('did-navigate-in-page', onNavigate);
    const cleanupLogin = () => {
      clearInterval(timer);
      signal?.removeEventListener('abort', onAbort);
      loginWindow.webContents.removeListener('did-navigate', onNavigate);
      loginWindow.webContents.removeListener('did-navigate-in-page', onNavigate);
    };
    loginWindow.on('closed', async () => {
      credentials = null;
      cleanupLogin();
      if (!finished) {
        finished = true;
        if (!existingAccount) await ses.clearStorageData().catch(() => {});
        resolve(null);
      }
    });
    void checkLogin();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 480,
    minHeight: 560,
    backgroundColor: '#101114',
    title: 'AltCrate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://case-clicker.com/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localDev = process.env.VITE_DEV_SERVER_URL;
    const localFile = `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
    if (url !== localDev && !url.startsWith(`${localFile}#`) && url !== localFile) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  accounts = createAccountRegistry(storage());
  await accounts.ready();
  const localStore=name=>createJsonStore(path.join(app.getPath('userData'),name));
  const accountWorkspace=createAccountWorkspace({...localStore('account-workspace.json'),listAccounts:()=>accounts.list()});
  await accountWorkspace.ready();
  const assertLocalSender=event=>{if(event.sender!==mainWindow?.webContents)throw Error('Pedido local inválido');};
  const trustedIpc={handle(channel,handler){ipcMain.handle(channel,(event,...args)=>{assertLocalSender(event);return handler(event,...args);});}};
  registerAccountWorkspaceIpc({ipcMain:trustedIpc,service:accountWorkspace});
  operationHistory=createOperationHistory({store:localStore('operation-history.json')});await operationHistory.ready();
  ipcMain.handle('history:query',(event,filters)=>{assertLocalSender(event);return operationHistory.query(filters);});
  ipcMain.handle('history:export',async event=>{assertLocalSender(event);await operationHistory.flush();const choice=await dialog.showSaveDialog(mainWindow,{title:'Exportar histórico persistente',defaultPath:'altcrate-historico.json',filters:[{name:'JSON',extensions:['json']}]});if(choice.canceled||!choice.filePath)return null;await fs.writeFile(choice.filePath,JSON.stringify(operationHistory.export(),null,2),{mode:0o600});return choice.filePath;});
  ipcMain.handle('extensions:capabilities',event=>{assertLocalSender(event);return listExtensionCapabilities();});
  ipcMain.handle('requests:metrics',event=>{assertLocalSender(event);return requestWork.metrics();});
  const preferencesFile=path.join(app.getPath('userData'),'app-preferences.json');
  const appPreferences=createAppPreferences({
    load:async()=>{try{return JSON.parse(await fs.readFile(preferencesFile,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}},
    save:async value=>{const temp=preferencesFile+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.rename(temp,preferencesFile);},
  });
  await appPreferences.ready();
  const preferenceSender=event=>{if(event.sender!==mainWindow?.webContents)throw Error('Pedido de definições inválido.');};
  ipcMain.handle('preferences:read',event=>{preferenceSender(event);return appPreferences.read();});
  ipcMain.handle('preferences:update',async(event,patch)=>{preferenceSender(event);return appPreferences.update(patch);});
  let coordinator;
  const serverDesktop=await createServerDesktop({restoreBudgets:(rates,routes)=>coordinator.restore(rates,routes),directory:app.getPath('userData'),listAccounts:()=>accounts.list(),sessionForPartition:partition=>session.fromPartition(partition),emit,
    readLegacySources:async()=>{const candidates=[path.join('/Applications/CasePilot.app','Contents/Resources/app.asar/electron/serverFarmSsh.cjs'),path.join(app.getAppPath(),'electron/serverFarmSsh.cjs')];const sources=[];for(const candidate of candidates){try{sources.push(await fs.readFile(candidate,'utf8'));}catch{}}return sources;}
  });
  const initialServerConfig=await serverDesktop.readConfig();
  const initialAccounts=await accounts.list();let localFarm;
  coordinator=withRouteBudgets({coordinator:createClickCoordinator({store:rateStorage()}),routeCoordinator:createClickCoordinator({store:serverDesktop.routeStore}),routeFor:id=>farmNetwork?.groupKey(id)||'direct',accountIds:()=>localFarm?.status().accounts.map(account=>account.id)||initialAccounts.map(account=>account.id)});
  farmNetwork = createFarmNetwork({
    sessionForPartition: partition => session.fromPartition(partition),
    onAccountReady: (id,key) => coordinator.inheritRoute(key,id),
    readConfig: async () => {
      if(initialServerConfig.enabled)return {};
      try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'farm-network.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
  });
  await farmNetwork.ready(await accounts.list());
  localAi = createLocalAi({directory:path.join(app.getPath('userData'),'local-ai')});
  localAi.prepare().catch(()=>{});
  ipcMain.handle('local-ai:status',()=>localAi.status());
  ipcMain.handle('local-ai:prepare',()=>localAi.prepare());
  ipcMain.handle('local-ai:decision',(_event,state)=>localAi.predict(state));
  const routed = farmNetwork.status().connections > 1;
  const limitGroup = routed ? (until, id) => coordinator.limitRoute(farmNetwork.groupKey(id),until,farmNetwork.groupAccounts(id)) : undefined;
  const accountQueue = createAccountQueue();
  const progressionStartGuard = () => {
    progressionWriteGuard();
  };
  snapshots = createAccountSnapshots({ apiForAccount: getApi, coordinator, limitGroup });
  games = createGames({ fetchForAccount: (account) => {
    const ses = session.fromPartition(account.partition);
    return (endpoint, init) => ses.fetch(ORIGIN + endpoint, init);
  }, accountQueue, coordinator });
  socketGames = createSocketGames({ fetchForAccount: (account) => {
    const ses = session.fromPartition(account.partition);
    return (endpoint, init) => ses.fetch(ORIGIN + endpoint, init);
  }, websocketTransportForAccount: (account) => {
    const ses = session.fromPartition(account.partition);
    return class ChromiumWebSocket extends EngineWebSocket {
      createSocket(uri, protocols) {
        return new net.WebSocket(uri, { session: ses, origin: ORIGIN, useSessionCookies: true, ...(protocols ? { protocols } : {}) });
      }
    };
  }, emit, accountQueue, requireAvailability:(account,game,options)=>games.requireAvailability(account,game,options) });
  localFarm = createFarmOrchestrator({ accounts: await accounts.list(), apiForAccount: getApi, emit:serverDesktop.emitLocal, coordinator, accountQueue, snapshots, stateStore: farmStorage(), maxInFlight:8, accountClickLimits:true, smoothClicks:routed, alignCaseClicks:true, steadyCaseClicks:true, limitGroup, networkStatus:()=>farmNetwork.status() });
  farm=createRemoteFarm({local:{...localFarm,status:()=>serverDesktop.localStatus(localFarm.status())},emit,rpcForProfile:profile=>createServerSsh({profile}),
    readConfig:serverDesktop.readConfig,writeConfig:serverDesktop.writeConfig,preparePayload:serverDesktop.preparePayload,restoreLocalState:serverDesktop.restoreLocalState
  });
  await farm.ready();
  const setupServer=createServerSetup();
  farmControls=registerFarmIpc({ipcMain,farm,emit,beforeStart:progressionStartGuard,validateSender:preferenceSender,serverProfile:serverDesktop.serverProfile,
    setupServer:profile=>setupServer(profile,{progress:stage=>emit({type:'server-setup',stage})}),
    identity:async profile=>(await probeServerIdentity(profile)).map(({type,fingerprint})=>({type,fingerprint})),trustIdentity:(profile,fingerprint)=>trustServerIdentity(profile,fingerprint),
    chooseKey:async()=>{const selection=await dialog.showOpenDialog(mainWindow,{title:'Escolher chave SSH',properties:['openFile']});return selection.canceled?null:selection.filePaths[0];},
    restartApp:()=>{progressionStartGuard();if(otherOperations.busy()||farmControls?.busy()||accountOperation||['running','stopping'].includes(accountLogins?.status().phase)||['running','stopping'].includes(openScheduler?.status().phase)||['running','stopping'].includes(farm.status().phase))throw Error('Para as operações antes de reiniciar');app.relaunch();setTimeout(()=>app.quit(),100);return {restarting:true};}
  });
  const inventoryFetchForAccount=createCoordinatedTransport({requestWork,coordinator,fetchForAccount:account=>(endpoint,options)=>session.fromPartition(account.partition).fetch(ORIGIN+endpoint,options)});
  const caseShowcase=createCaseShowcase({listAccounts:()=>accounts.list(),fetchForAccount:account=>inventoryFetchForAccount(account,{priority:'background'})});
  ipcMain.handle('cases:showcase',()=>caseShowcase.list());
  ipcMain.handle('cases:details',(_event,id)=>caseShowcase.detail(id));
  const itemLocator=createItemLocator({listAccounts:()=>accounts.list(),fetchForAccount:inventoryFetchForAccount,accountQueue});
  const storageReader=createStorageReader({listAccounts:()=>accounts.list(),fetchForAccount:inventoryFetchForAccount,coordinator});
  const storageDeposit=createStorageDeposit({listAccounts:()=>accounts.list(),listStorageUnits:id=>storageReader.list(id),apiForAccount:getApi,locator:itemLocator,accountQueue,coordinator});
  const operationStore=createInventoryOperationStore({filePath:path.join(app.getPath('userData'),'inventory-operations.json')});
  const tradeTransport=createTradeTransport({fetchForAccount:inventoryFetchForAccount,accountQueue,websocketTransportForAccount:account=>{
    const ses=session.fromPartition(account.partition);
    return class TradeChromiumWebSocket extends EngineWebSocket {createSocket(uri,protocols){return new net.WebSocket(uri,{session:ses,origin:ORIGIN,useSessionCookies:true,...(protocols?{protocols}:{})});}};
  }});
  const inventoryDeps={listAccounts:()=>accounts.list(),apiForAccount:getApi,locator:itemLocator,accountQueue,coordinator,store:operationStore,storageDeposit,emit};
  const transferService=createInventoryTransfers({...inventoryDeps,transport:tradeTransport});
  inventoryActions=createInventoryActions({...inventoryDeps,transferService});
  await inventoryActions.list();
  const runInventoryRecovery=async(id,work)=>{
    baseProgressionWriteGuard();
    if(inventoryBatchBusy||otherOperations.busy()||progressionBatch?.active())throw Error('Aguarda o fim da operação atual');
    inventoryBatchBusy++;
    try{
      if(inventoryBatch?.hasPending()){
        const op=(await operationStore.list()).find(r=>r.operationId===id);
        const matching=(await inventoryBatch.list()).some(b=>b.items.some(row=>row.operationId===id||op&&row.preview.previewId===op.previewId));
        if(!matching)throw Error('Resolve primeiro a operação associada ao lote pendente');
      }
      return await work();
    }finally{inventoryBatchBusy--;}
  };
  registerInventoryActionsIpc({ipcMain,service:{...inventoryActions,
    confirm:id=>otherOperations.run(()=>inventoryActions.confirm(id)),
    resume:id=>runInventoryRecovery(id,()=>inventoryActions.resume(id)),
    cancel:id=>runInventoryRecovery(id,()=>inventoryActions.cancel(id)),
  }});
  inventoryBatch=createInventoryBatch({actions:inventoryActions,operationStore,locator:itemLocator,filePath:path.join(app.getPath('userData'),'inventory-batches.json'),emit});
  await inventoryBatch.list();
  storageManagement=createStorageManagement({reader:storageReader,listAccounts:()=>accounts.list(),apiForAccount:getApi,locator:itemLocator,accountQueue,coordinator,store:createJsonStore(path.join(app.getPath('userData'),'storage-management.json')),emit});
  await storageManagement.list();
  registerStorageManagementIpc({ipcMain:trustedIpc,service:{...storageManagement,
    confirm:id=>otherOperations.run(async()=>{if(['running','stopping'].includes(farm.status().phase)||['running','stopping'].includes(openScheduler?.status().phase))throw Error('Para a farm e a abertura antes de alterar cofres');await inventoryActions.list();if((await accounts.list()).some(a=>inventoryActions.blocksAccount(a.id)))throw Error('Resolve as operações pendentes do inventário antes de alterar cofres');return storageManagement.confirm(id);}),
    verify:id=>{baseProgressionWriteGuard();if(inventoryBatchBusy||inventoryBatch?.hasPending()||progressionBatch?.active()||otherOperations.busy())throw Error('Aguarda o lote atual');return storageManagement.verify(id);},
  }});
  const runInventoryBatch=fn=>otherOperations.run(async()=>{inventoryBatchBusy++;try{return await fn();}finally{inventoryBatchBusy--;}});
  // Resume and verification must be allowed to resolve this batch's own pending rows.
  registerInventoryBatchIpc({ipcMain:trustedIpc,service:{...inventoryBatch,start:id=>runInventoryBatch(()=>inventoryBatch.start(id)),resume:id=>{baseProgressionWriteGuard();if(progressionBatch?.active()||inventoryBatchBusy||otherOperations.busy())throw Error('Aguarda o outro lote');inventoryBatchBusy++;return inventoryBatch.resume(id).finally(()=>{inventoryBatchBusy--;});},verify:id=>{baseProgressionWriteGuard();if(inventoryBatchBusy)throw Error('Aguarda o lote');return inventoryBatch.verify(id);}}});
  const itemRanking=createItemRanking({...localStore('item-ranking.json'),fetchForAccount:id=>async(endpoint)=>{const account=(await accounts.list()).find(a=>a.id===id);if(!account)throw Error('Conta não encontrada');return inventoryFetchForAccount(account)(endpoint,{method:'GET',credentials:'include',cache:'no-store'});}});await itemRanking.ready();
  const rankRefs=async(request,limit=25)=>{if(!request||typeof request.accountId!=='string'||!Array.isArray(request.itemIds)||!request.itemIds.length||request.itemIds.length>limit||new Set(request.itemIds).size!==request.itemIds.length||request.itemIds.some(id=>! /^[a-f0-9]{24}$/i.test(id)))throw Error('Seleciona até '+limit+' itens diferentes');if(!(await accounts.list()).some(a=>a.id===request.accountId))throw Error('Conta não encontrada');return request.itemIds.map(itemId=>({accountId:request.accountId,itemId}));};
  ipcMain.handle('ranking:read',async(event,request)=>{assertLocalSender(event);const refs=await rankRefs(request,200);return {capability:itemRanking.capability(),items:refs.map(ref=>itemRanking.read(ref))};});
  ipcMain.handle('ranking:refresh',async(event,request)=>{assertLocalSender(event);const refs=await rankRefs(request),items=[];for(const ref of refs){try{const located=await itemLocator.locate({...ref,page:1,storageUnitId:null});const result=await itemRanking.refresh({...ref,identity:itemRankingIdentity(located.item)});if(await itemLocator.identity(ref.accountId)!==located.identity)throw Error('A sessão mudou durante a consulta');items.push(result);}catch(error){items.push({...ref,state:'unavailable',rank:null,reason:String(error.message||error).slice(0,250)});if(error.status===429)break;}}return {capability:itemRanking.capability(),items};});
  const openingPolicy=createOpeningPolicy({apiForAccount:getApi,inventoryActions,emit,itemRanking});
  openScheduler = createOpenScheduler({ apiForAccount: getApi, emit, coordinator, accountQueue,isItemReserved:(accountId,itemId)=>inventoryActions.isItemReserved(accountId,itemId),onOpenedItems:(entry,ids,config,context)=>openingPolicy.apply(entry.account,ids,config.itemRules,context) });
  const converterFile=path.join(app.getPath('userData'),'token-converter.json');
  tokenConverter=createTokenConverter({listAccounts:()=>accounts.list(),apiForAccount:getApi,transport:tradeTransport,accountQueue,coordinator,emit,
    store:{async load(){try{return JSON.parse(await fs.readFile(converterFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
      async save(value){const temporary=converterFile+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,converterFile);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}}},
    canStart:async ids=>{
      await farm.refresh?.(true);
      if(storageManagement?.hasPending()||inventoryBatchBusy||inventoryBatch?.hasPending()||progressionBatch?.active()||progressionBusy||progression?.hasPending()||otherOperations.busy()||farmControls.busy()||accountOperation||['running','stopping'].includes(accountLogins?.status().phase)||['running','stopping'].includes(farm.status().phase)||['running','stopping'].includes(openScheduler.status().phase))throw Error('Para as outras operações antes de iniciar o conversor.');
      if(farm.status().execution?.kind==='server'&&!farm.status().execution.connected)throw Error('Confirma a paragem do farm no servidor antes de iniciar o conversor.');
      await inventoryActions.list();if(ids.some(id=>inventoryActions.blocksAccount(id)))throw Error('Resolve o envio pendente no inventário antes de converter.');
    },
  });
  await tokenConverter.ready();
  registerTokenConverterIpc({ipcMain,service:tokenConverter,validateSender:event=>{if(event.sender!==mainWindow?.webContents)throw Error('Pedido inválido.');}});
  accountLogins = createLoginQueue({
    list: () => accounts.list(), emit,
    isConnected: async account => {
      const response = await session.fromPartition(account.partition).fetch(`${ORIGIN}/api/me`, { method: 'GET', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.status === 429) throw Error('O site limitou os logins. Aguarda antes de continuar.');
      if (response.status >= 500) throw Error('O site está indisponível. Tenta mais tarde.');
      if (!response.ok) return false;
      const me = await response.json();
      return Number.isFinite(Number(me.money)) && typeof me.role === 'string' && (!account.email || typeof me.email !== 'string' || me.email.toLowerCase() === account.email);
    },
    login: (account, options) => loginAccount(account.label, account, options),
  });
  ipcMain.handle('accounts:connect-all', (event, ids) => accountTask(event, () => accountLogins.start(ids)));
  ipcMain.handle('accounts:login-status', () => accountLogins.status());
  ipcMain.handle('accounts:login-stop', event => {
    if (event.sender !== mainWindow?.webContents) throw Error('Pedido inválido.');
    return accountLogins.stop();
  });
  ipcMain.handle('accounts:list', () => accounts.list());
  ipcMain.handle('accounts:login', (event, label) => accountTask(event, () => loginAccount(label)));
  ipcMain.handle('accounts:import', event => accountTask(event, importAccountFile));
  ipcMain.handle('accounts:connect', (event, id) => accountTask(event, async () => {
    const account = (await accounts.list()).find(item => item.id === id);
    if (!account) throw Error('Conta não encontrada.');
    return loginAccount(account.label, account);
  }));
  ipcMain.handle('accounts:remove', (_event, id) => otherOperations.run(async()=>{
    progressionStartGuard();
    if (typeof id !== 'string') throw new Error('Conta inválida');
    if(tokenConverter.blocksAccount(id))throw Error('Para o conversor e resolve a operação pendente antes de remover a conta.');
    if (accountOperation) throw Error('Aguarda a operação de contas em curso.');
    if (['running', 'stopping'].includes(farm.status().phase) || ['running', 'stopping'].includes(openScheduler.status().phase)) {
      throw new Error('Para a execução antes de remover uma conta');
    }
    await inventoryActions.list();
    if(inventoryActions.blocksAccount(id))throw Error('Resolve a operação pendente do inventário antes de remover a conta');
    const removed = await accounts.remove(id);
    if (removed) {
      await farmNetwork.ready(await accounts.list());
      await farm.syncAccounts(await accounts.list());
      snapshots?.remove(id);
      socketGames.dispose(id);
      const ses = session.fromPartition(removed.partition);
      await ses.clearStorageData();
      await ses.clearCache();
      emit({ type: 'account-removed', id });
    }
    return Boolean(removed);
  }));
  ipcMain.handle('accounts:refresh', async (_event, id) => {
    const account = (await accounts.list()).find((item) => item.id === id);
    if (!account) throw new Error('Conta não encontrada');
    return farm.isRemote()?farm.snapshot(id):snapshots.read(account);
  });
  const readInventory=createInventoryReader({listAccounts:()=>accounts.list(),fetchForAccount:account=>(endpoint,init)=>session.fromPartition(account.partition).fetch(ORIGIN+endpoint,init)});
  ipcMain.handle('inventory:read',(_event,accountId,page,filters)=>readInventory(accountId,page,filters));
  ipcMain.handle('inventory:summary',(_event,accountId)=>readInventory.summary(accountId));
  progression = createProgressionService({
    listAccounts:()=>accounts.list(),fetchForAccount:inventoryFetchForAccount,accountQueue,coordinator,emit,store:localStore('progression-operations.json'),
    siteOpeningEnabled:()=>appPreferences.read().enableSiteOpening,
    mutationGuard:async()=>{
      converterGuard();
      if (['running','stopping'].includes(farm.status().phase)||['running','stopping'].includes(openScheduler.status().phase)) throw Error('Para a farm e a abertura antes de alterar recompensas, skills ou auto-open.');
    },
  });
  await progression.ready();
  const progressionEntryGuard=createProgressionEntryGuard({converterGuard,hasOtherWork:()=>storageManagement?.hasPending()||inventoryBatchBusy>0||inventoryBatch?.hasPending()||otherOperations.busy()||farmControls.busy()||accountOperation||['running','stopping'].includes(accountLogins?.status().phase)});
  registerProgressionIpc({ipcMain,service:progression,runMutation:async fn=>{
    progressionEntryGuard();
    if(progressionBusy||progressionBatch?.active())throw Error('Aguarda ou verifica o lote de progressão.');
    progressionBusy++;
    try{return await fn();}finally{progressionBusy--;}
  }});
  progressionBatch=createProgressionBatch({progression,listAccounts:()=>accounts.list(),store:localStore('progression-batches.json'),emit});await progressionBatch.ready();
  registerProgressionBatchIpc({ipcMain:trustedIpc,service:progressionBatch,runMutation:async fn=>{progressionEntryGuard();if(progressionBusy)throw Error('Aguarda a alteração atual');progressionBusy++;try{return await fn();}finally{progressionBusy--;}}});
  ipcMain.handle('storage:list',(_event,accountId)=>storageReader.list(accountId));
  ipcMain.handle('storage:cooldown',()=>coordinator.cooldown());
  ipcMain.handle('storage:read',(_event,accountId,id,page,filters)=>storageReader.read(accountId,id,page,filters));
  ipcMain.handle('open:status', () => openScheduler.status());
  ipcMain.handle('open:start', (_event, config) => otherOperations.run(async()=>{
    progressionStartGuard();
    if (!config || !Array.isArray(config.accountIds)) throw new Error('Seleciona as contas');
    const known = await accounts.list();
    const selected = config.accountIds.map((id) => known.find((account) => account.id === id));
    if (!selected.length || selected.some((account) => !account) || new Set(config.accountIds).size !== config.accountIds.length) throw new Error('Seleciona contas válidas e diferentes');
    if (['running', 'stopping'].includes(openScheduler.status().phase)) throw new Error('A abertura já está ativa');
    if(config.itemRules!==undefined&&!Array.isArray(config.itemRules))throw Error('Regras de abertura inválidas');
    const itemRules=Array.isArray(config.itemRules)&&config.itemRules.length?validateOpeningRules(config.itemRules,await caseShowcase.detail(config.caseId)):[];
    if(itemRules.length&&config.convert===true)throw Error('Escolhe regras por skin ou conversão por preço');
    if (config.testOnce === true && (selected.length !== 1 || config.convert !== true&&!itemRules.length)) throw new Error('Seleciona uma conta e configura uma regra ou conversão para testar uma caixa');
    const checkedStorages=new Set(),checkedPairs=new Set();
    for(const rule of itemRules.filter(item=>item.action==='storage')){
      const storageKey=rule.destinationAccountId+':'+rule.storageUnitId;
      if(!checkedStorages.has(storageKey)){await storageDeposit.preflight(rule.destinationAccountId,rule.storageUnitId);checkedStorages.add(storageKey);}
      for(const source of selected){if(source.id===rule.destinationAccountId)continue;const pair=source.id+':'+rule.destinationAccountId;if(!checkedPairs.has(pair)){await transferService.preflight({ref:{accountId:source.id},destinationAccountId:rule.destinationAccountId});checkedPairs.add(pair);}}
    }
    const settings = {
      accounts: selected, caseId: config.caseId, continuous: config.testOnce !== true, maxOpens: config.testOnce === true ? 1 : undefined, adaptive: true, testOnce: config.testOnce === true,
      concurrency: Math.min(selected.length, 20),
      convert: config.convert === true, conversionMode: config.conversionMode, maxPrice: Number(config.maxPrice), conversionCap: config.testOnce === true ? 1 : null,itemRules,
    };
    const promise = openScheduler.start(settings);
    promise.catch((error) => emit({ type: 'run-error', message: String(error.message || error).slice(0, 180) }));
    return openScheduler.status();
  }));
  ipcMain.handle('open:stop', () => openScheduler.stop());
  async function gameAccount(accountId) {
    if (typeof accountId !== 'string') throw new Error('Conta inválida');
    const account = (await accounts.list()).find((item) => item.id === accountId);
    if (!account) throw new Error('Conta não encontrada');
    return account;
  }
  ipcMain.handle('games:load', async (_event, accountId, game, options) => {
    const account = await gameAccount(accountId);
    const snapshot = await games.load(account, game);
    if (ROOMS[game]) return { ...snapshot, supported: true, socket: await socketGames.load(account, game, {resume:options?.resume === true}) };
    return snapshot;
  });
  ipcMain.handle('games:leave', (_event, accountId, game) => socketGames.leave(accountId, game));
  ipcMain.handle('blackjack:history', async (_event, accountId) => {
    if (accountId != null) await gameAccount(accountId);
    return socketGames.history(accountId);
  });
  ipcMain.handle('games:options', async (_event, accountId, game, tokens, targetPrice) => games.options(await gameAccount(accountId), game, tokens, targetPrice));
  ipcMain.handle('games:action', (_event, accountId, game, action, payload) => otherOperations.run(async()=>{
    progressionStartGuard();
    const account = await gameAccount(accountId);
    const result = ROOMS[game] ? await socketGames.perform(account, game, action, payload) : await games.perform(account, game, action, payload);
    emit({ type: 'game', accountId, game, action, result, at: new Date().toISOString() });
    return result;
  }));
  ipcMain.handle('run:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar relatório de execução',
      defaultPath: `case-clicker-testes-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const farmPhase = farm.status().phase;
    const summary = (kind) => {
      const rows = evidence.filter((event) => kind === 'vault' ? event.type === 'vault' : event.type === 'request' && event.kind === kind);
      return { phase: farmPhase, sent: rows.length, succeeded: rows.filter((event) => event.httpStatus >= 200 && event.httpStatus < 300).length, failed: rows.filter((event) => event.httpStatus < 200 || event.httpStatus >= 300).length };
    };
    const report = createReport({
      accounts: await accounts.list(), status: { case: summary('case'), money: summary('money'), vault: summary('vault'), farm: farm.status(), opening: openScheduler.status(),converter:tokenConverter.status() }, events: evidence, inventoryOperations:await inventoryActions.list(), blackjack: socketGames.history(),
    });
    await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), { mode: 0o600 });
    return result.filePath;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let quittingAfterFlush=false;
app.on('before-quit',event=>{
  localAi?.dispose();
  if(quittingAfterFlush)return;
  if(!operationHistory){tokenConverter?.stop().catch(()=>{});return;}
  event.preventDefault();
  Promise.resolve().then(()=>tokenConverter?.stop()).catch(()=>{}).then(()=>operationHistory.flush()).catch(()=>{}).finally(()=>{quittingAfterFlush=true;app.quit();});
});
