export const emptyServerProfile=()=>({name:'',host:'',port:22,user:'',keyPath:'',nodePath:'/usr/bin/node',controlPath:'/opt/casepilot-farm/serverFarmControl.cjs',dataDirectory:'/var/lib/casepilot-farm',serviceName:'casepilot-farm'});
export function createServerSettingsController({bridge,onChange=()=>{}}){
 let state={config:{enabled:false},draft:emptyServerProfile(),destination:'local',identities:[],tested:false,busy:false,loading:true,error:'',notice:''};
 const snapshot=()=>({...state,draft:{...state.draft},config:{...state.config},identities:[...state.identities]});const update=patch=>{state={...state,...patch};onChange(snapshot());};
 const complete=()=>{if(!state.draft.host.trim()||!state.draft.user.trim()||!state.draft.keyPath)throw Error('Preenche o endereço, utilizador e chave SSH');};
 async function run(work){if(state.busy)return;update({busy:true,error:'',notice:''});try{return await work();}catch(error){try{const config=await bridge.farmServerConfig?.();if(config)update({config});}catch{}update({error:String(error.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')});}finally{update({busy:false});}}
 const api={snapshot,
  async load(){try{const config=await bridge.farmServerConfig();update({config,draft:{...emptyServerProfile(),...config.profile},destination:config.enabled?'server':config.preferredExecution==='local'?'local':config.profile?'server':'local',error:config.error||''});}catch(error){update({error:String(error.message||error)});}finally{update({loading:false});}},
  chooseDestination(destination){if(!state.busy&&['local','server'].includes(destination))update({destination,error:'',notice:''});},
  changeDraft(patch){if(!state.busy)update({draft:{...state.draft,...patch},identities:[],tested:false,networkCheck:null,error:'',notice:''});},
  chooseKey:()=>run(async()=>{const keyPath=await bridge.farmChooseServerKey();if(/\.pub$/i.test(keyPath||''))throw Error('Escolhe a chave privada SSH, sem a extensão .pub.');if(keyPath)update({draft:{...state.draft,keyPath},identities:[],tested:false});}),
  inspectIdentity:()=>run(async()=>{complete();const identities=await bridge.farmServerIdentity(state.draft);update({identities,tested:false});}),
  trustIdentity:fingerprint=>run(async()=>{complete();if(!state.identities.some(item=>item.fingerprint===fingerprint))throw Error('Escolhe uma identidade apresentada pelo servidor');await bridge.farmTrustServer(state.draft,fingerprint);update({identities:[],notice:'Identidade confirmada. Testa agora a ligação.'});}),
  installationProgress(stage){if(state.busy)update({notice:({checking:'A verificar o servidor…',downloading:'A preparar o Node para o servidor…',installing:'A instalar e verificar o worker…',network:'A verificar a ligação do servidor ao jogo…',ready:'Servidor configurado. Guarda a ligação e envia as contas na página Automação.'})[stage]||state.notice});},
  setup:()=>run(async()=>{update({tested:false,networkCheck:null,notice:'A verificar o servidor…'});complete();const result=await bridge.farmSetupServer(state.draft);update({draft:{...state.draft,...result.profile},tested:true,capabilities:result.capabilities,networkCheck:result.networkCheck,identities:[],notice:'Servidor configurado. Guarda a ligação e envia as contas na página Automação.'});}),
  test:()=>run(async()=>{update({tested:false,networkCheck:null});complete();const tested=await bridge.farmTestServer(state.draft);update({tested:true,capabilities:tested.capabilities,networkCheck:tested.networkCheck,notice:tested.legacyWorker?'Ligação verificada. O worker antigo permite acompanhar o farm; atualiza-o para transferir contas.':'Ligação verificada. Podes guardar este servidor.'});}),
  saveServer:()=>run(async()=>{complete();if(!state.tested)throw Error('Testa a ligação antes de guardar o servidor');const config=await bridge.farmConfigureServer(state.draft);update({config,draft:{...emptyServerProfile(),...config.profile},notice:config.enabled?'Farm associado ao servidor escolhido.':'Ligação guardada. Envia as contas na página Automação.'});}),
  saveLocal:()=>run(async()=>{const config=await bridge.farmMoveToLocal();update({config,destination:'local',notice:config.restartRequired?'Sessões e limites recuperados. Reinicia a app para continuar.':'O farm usa este computador.'});}),
  recover:()=>run(async()=>{await bridge.farmRecoverServer();await api.load();}),
  restart:()=>run(()=>bridge.farmRestartApp()),
 };
 return api;
}
