function registerInventoryActionsIpc({ipcMain,service}){
 const identifier=value=>{if(typeof value!=='string'||!value||value.length>100)throw Error('Identificador inválido');return value;};
 ipcMain.handle('inventory-action:prepare',(_event,request)=>service.prepare(request));
 ipcMain.handle('inventory-action:confirm',(_event,id)=>service.confirm(identifier(id)));
 ipcMain.handle('inventory-action:list',()=>service.list());
 ipcMain.handle('inventory-action:verify',(_event,id)=>service.verify(identifier(id)));
 ipcMain.handle('inventory-action:resume',(_event,id)=>service.resume(identifier(id)));
 ipcMain.handle('inventory-action:cancel',(_event,id)=>service.cancel(identifier(id)));
}
module.exports={registerInventoryActionsIpc};
