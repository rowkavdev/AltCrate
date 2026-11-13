function registerTokenConverterIpc({ipcMain,service,validateSender}) {
  const id=value=>{if(typeof value!=='string'||!value||value.length>100)throw Error('Operação inválida');return value;};
  const register=(name,work)=>ipcMain.handle('converter:'+name,(event,...args)=>{validateSender(event);return work(...args);});
  register('status',()=>service.status());
  register('inspect',config=>service.inspect(config));
  register('prepare',async config=>{try{return await service.prepare(config);}catch(error){if(error.converterIssue?.code==='autosell')return {blocked:true,issues:[error.converterIssue]};throw error;}});
  register('start',config=>service.start(config));
  register('stop',()=>service.stop());
  register('stop-account',value=>service.stopAccount(id(value)));
  register('clear',()=>service.clear());
  register('resume',value=>service.resume(id(value)));
  register('verify',value=>service.verify(id(value)));
  register('close-unresolved',value=>service.closeUnresolved(id(value)));
  register('cancel',value=>service.cancel(id(value)));
  register('acknowledge',value=>service.acknowledge(id(value)));
}
module.exports={registerTokenConverterIpc};
