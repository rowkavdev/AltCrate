const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {transformSync}=require('../node_modules/esbuild');

test('Join all omits the optional selection across JSON IPC; explicit selections stay intact',async()=>{
  const calls=[];
  const source=fs.readFileSync(path.resolve(__dirname,'../../casepilot/apps/web/src/desktopBridge.js'),'utf8');
  const {code}=transformSync(source,{format:'cjs',define:{'import.meta.env.DEV':'false'}});
  const module={exports:{}};
  const context={module,exports:module.exports,window:{},require:name=>{
    if(name==='@tauri-apps/api/core')return {isTauri:()=>true,invoke:async(command,payload)=>{calls.push(JSON.parse(JSON.stringify({command,payload})));}};
    if(name==='@tauri-apps/api/event')return {listen:async()=>()=>{}};
    throw Error('Unexpected import: '+name);
  }};
  vm.runInNewContext(code,context);await module.exports.installDesktopBridge();
  await context.window.caseClicker.connectImportedAccounts();
  await context.window.caseClicker.connectImportedAccounts(['account-a','account-b']);
  await context.window.caseClicker.connectImportedAccounts([]);
  assert.deepEqual(calls,[
    {command:'engine_invoke',payload:{channel:'accounts:connect-all',args:[]}},
    {command:'engine_invoke',payload:{channel:'accounts:connect-all',args:[['account-a','account-b']]}},
    {command:'engine_invoke',payload:{channel:'accounts:connect-all',args:[[]]}},
  ]);
});
