function registerProgressionIpc({ipcMain,service,runMutation=fn=>fn()}) {
 const identifier=value=>{if(typeof value!=='string'||!value||value.length>120)throw Error('Identificador inválido');return value;};
 ipcMain.handle('progression:rewards',(_,id)=>service.rewards(identifier(id)));
 ipcMain.handle('progression:missions',(_,id)=>service.missions(identifier(id)));
 ipcMain.handle('progression:skills',(_,id,map)=>service.skills(identifier(id),map));
 ipcMain.handle('progression:presets',(_,id)=>id===undefined?service.presets():service.presetCatalog(identifier(id)));
 ipcMain.handle('progression:autoopen',(_,id)=>service.autoOpen(identifier(id)));
 ipcMain.handle('progression:prepare',(_,id,kind,payload)=>service.prepare(identifier(id),kind,payload));
 ipcMain.handle('progression:confirm',(_,id)=>runMutation(()=>service.confirm(identifier(id))));
 ipcMain.handle('progression:verify',(_,id)=>runMutation(()=>service.verify(identifier(id))));
 ipcMain.handle('progression:stop',(_,id)=>service.stop(identifier(id)));
 ipcMain.handle('progression:status',(_,id)=>service.status(identifier(id)));
 ipcMain.handle('progression:diagnostics',(_,id)=>service.diagnostics(identifier(id)));
}
module.exports={registerProgressionIpc};
