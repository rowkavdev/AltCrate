const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('real preload exposes file import without passing credentials and isolated account login',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync('electron/preload.cjs','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}})});
 assert.equal(typeof bridge.importAccounts,'function');assert.equal(typeof bridge.connectAccount,'function');
 await bridge.importAccounts();await bridge.connectAccount('account-id');
 assert.deepEqual(calls,[['accounts:import'],['accounts:connect','account-id']]);
});
test('real preload exposes start, stop and progress for sequential automatic logins',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync('electron/preload.cjs','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}})});
 assert.equal(typeof bridge.connectImportedAccounts,'function');assert.equal(typeof bridge.stopAccountLogins,'function');assert.equal(typeof bridge.accountLoginStatus,'function');
 await bridge.connectImportedAccounts();await bridge.stopAccountLogins();await bridge.accountLoginStatus();assert.deepEqual(calls,[['accounts:connect-all',undefined],['accounts:login-stop'],['accounts:login-status']]);
});
