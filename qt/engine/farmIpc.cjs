function registerFarmIpc({ ipcMain, farm, emit = () => {}, beforeStart = () => {}, validateSender=()=>{}, serverProfile=value=>value, identity, trustIdentity, chooseKey, restartApp, setupServer }) {
  let pending=0;
  const register=(channel,handler)=>ipcMain.handle(channel,(event,...args)=>{validateSender(event);return handler(event,...args);});
  const validate=ids=>{if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('Seleciona contas válidas e diferentes');};
  const track=async work=>{pending++;try{return await work();}finally{pending--;}};
  register('farm:status', async () => {await farm.refresh?.();return farm.status();});
  register('farm:start', (_event, accountIds) => track(async()=>{
    validate(accountIds);beforeStart(accountIds);
    await farm.ready?.();
    const known = new Set((farm.status().accounts || []).map((account) => account.id));
    if (known.size && accountIds.some((id) => !known.has(id))) throw new Error('Conta não encontrada');
    beforeStart(accountIds);
    if(farm.isRemote?.())return farm.start(accountIds);
    track(()=>farm.start(accountIds)).catch((error) => emit({ type: 'run-error', message: String(error.message || error).slice(0, 180) }));
    await Promise.resolve();
    return farm.status();
  }));
  register('farm:stop', () => farm.stop());
  register('farm:modes', (_event, id, modes) => farm.setModes(id, modes));
  register('farm:pause', (_event, id) => farm.pause(id));
  register('farm:resume', (_event, id) => track(()=>{beforeStart([id]);return farm.resume(id);}));
  if(typeof farm.migrate==='function')register('farm:server',(_event,ids)=>track(()=>{validate(ids);beforeStart(ids);return farm.migrate(ids);}));
  if(farm.configuration){
    register('farm:server-config',()=>farm.configuration());
    if(setupServer)register('farm:server-setup',(_event,profile)=>track(()=>{beforeStart();return setupServer(serverProfile(profile));}));
    register('farm:server-test',(_event,profile)=>track(()=>farm.testServer(serverProfile(profile))));
    register('farm:server-configure',(_event,profile)=>track(()=>{beforeStart();return farm.configureServer(serverProfile(profile));}));
    register('farm:local',()=>track(()=>{beforeStart();return farm.moveToLocal();}));
    register('farm:server-recover',()=>track(()=>{beforeStart();return farm.recoverTransition();}));
    if(identity)register('farm:server-identity',(_event,profile)=>track(()=>identity(serverProfile(profile))));
    if(trustIdentity)register('farm:server-trust',(_event,profile,fingerprint)=>track(()=>trustIdentity(serverProfile(profile),fingerprint)));
    if(chooseKey)register('farm:server-key',()=>chooseKey());
    if(restartApp)register('farm:restart',()=>{if(!farm.configuration().restartRequired)throw Error('Não é necessário reiniciar');return restartApp();});
  }
  return {busy:()=>pending>0};
}

module.exports = { registerFarmIpc };
