function registerTokenConverterIpc({ipcMain,service,validateSender}) {
  const id=value=>{if(typeof value!=='string'||!value||value.length>100)throw Error('Operação inválida');return value;};
  const register=(name,work)=>ipcMain.handle('converter:'+name,(event,...args)=>{validateSender(event);return work(...args);});
  register('status',()=>service.status());
  register('start',config=>service.start(config));
  register('stop',()=>service.stop());
  register('verify',value=>service.verify(id(value)));
  register('cancel',value=>service.cancel(id(value)));
  register('acknowledge',value=>service.acknowledge(id(value)));
}
module.exports={registerTokenConverterIpc};
