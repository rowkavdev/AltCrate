function registerAccountWorkspaceIpc({ipcMain,service,renameAccount}){
 const commands=new Set(['createGroup','updateGroup','deleteGroup','reorderGroups','assignAccounts','selectGroup','saveProfile','deleteProfile','loadProfile']);
 ipcMain.handle('workspace:read',()=>service.read());
 ipcMain.handle('workspace:command',async(_event,action,payload)=>{
  if(action==='renameAccount'&&renameAccount){
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['id','label'].includes(key))||typeof payload.id!=='string'||typeof payload.label!=='string')throw Error('Nome da conta inválido.');
   await renameAccount(_event,payload);return service.read();
  }
  if(typeof action!=='string'||!commands.has(action))throw Error('Comando local desconhecido');
  return service[action](payload);
 });
}
module.exports={registerAccountWorkspaceIpc};
