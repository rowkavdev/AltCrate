function registerAccountWorkspaceIpc({ipcMain,service}){
 const commands=new Set(['createGroup','updateGroup','deleteGroup','reorderGroups','assignAccounts','selectGroup','saveProfile','deleteProfile','loadProfile']);
 ipcMain.handle('workspace:read',()=>service.read());
 ipcMain.handle('workspace:command',async(_event,action,payload)=>{
  if(typeof action!=='string'||!commands.has(action))throw Error('Comando local desconhecido');
  return service[action](payload);
 });
}
module.exports={registerAccountWorkspaceIpc};
