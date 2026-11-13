const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-compact-'));
app.setPath('userData',profile);
const output=path.resolve('artifacts/compact-workspace-2026-10-14/usability'),calls=[],checks=[];
ipcMain.on('fixture:call',(_,call)=>calls.push(call));
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({show:false,useContentSize:true,width:1440,height:1000,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,preload:path.join(__dirname,'fixtures/casepilot-preload.cjs'),additionalArguments:['--cp-count=100','--cp-state=idle']}});
 const consoleErrors=[];win.webContents.on('console-message',e=>{if(e.level==='error')consoleErrors.push(e.message);});
 const run=source=>win.webContents.executeJavaScript(source),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function route(name){await run(`location.hash=${JSON.stringify(name)};window.scrollTo(0,0)`);await delay(600);}
 async function assert(name,source){const passed=await run(source);checks.push({name,passed});if(!passed)throw Error(name);}
 const routes=[['accounts','.account-row',800],['inventory','.inventory-card',800],['opening','.opening-settings .primary-button',800],['games','.game-card',900],['rewards','.reward-card',700],['skills','.skill-preset-card',800],['activity','.event-row',850],['converter','.converter-run .primary-button',950]];
 try{
  fs.mkdirSync(output,{recursive:true});
  await win.loadFile(path.resolve(process.argv[2]||'dist/index.html'));await delay(900);
  for(const [name,selector,limit] of routes){await route(name);if(name==='activity'){await run(`window.farmFixture.emit({type:'request',kind:'case',accountId:'a1',httpStatus:200,verifiedDelta:1,snapshot:{money:100,casesTotal:1,cases:[]},at:new Date().toISOString()})`);await delay(100);}for(let i=0;i<60;i++){if(await run(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;await delay(100);}const rect=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {top:r.top,height:r.height};})()`);checks.push({name:name+'-first-view',...rect,passed:rect.top<limit&&rect.height>0});fs.writeFileSync(path.join(output,name+'-1440.png'),(await win.webContents.capturePage()).toPNG());}
  win.setContentSize(390,900);await route('accounts');
  await assert('mobile-first-account-visible',`document.querySelector('.account-row').getBoundingClientRect().top<700`);
  await run(`document.querySelector('.account-name-cell input').click()`);await delay(80);
  await assert('row-selection-updates-shared-selection',`document.querySelector('.selection-toolbar').textContent.includes('99')`);
  await route('inventory');await run(`document.querySelector('.inventory-select input').click()`);await delay(80);
  await assert('selecting-item-exposes-batch-controls',`[...document.querySelectorAll('.disclosure-panel')].some(el=>el.open&&el.querySelector('.inventory-batch-panel'))`);
  await run(`document.querySelector('.inventory-select input').click();document.querySelector('.inventory-batch-panel').closest('.disclosure-panel').open=false;window.farmFixture.emit({type:'inventory-batch',batch:{batchId:'fixture-active',state:'running',items:[],kind:'sell',createdAt:new Date().toISOString()}})`);await delay(100);
  await assert('active-inventory-batch-stop-visible',`(()=>{const button=[...document.querySelectorAll('.inventory-batch-review button')].find(el=>el.textContent==='Parar novos envios');return !!button&&button.getBoundingClientRect().height>0;})()`);
  await route('skills');await run(`document.querySelector('[role=tab][aria-selected=true]').focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});await delay(150);
  await assert('skill-tabs-support-arrow-keys',`document.querySelector('[role=tab][aria-selected=true]').textContent==='Mirage'`);
  await route('rewards');await run(`window.farmFixture.emit({type:'progression-batch',batch:{batchId:'fixture-progress',phase:'running',rows:[{rowId:'row',accountId:'a1',accountLabel:'Principal',state:'sending'}]}})`);await delay(100);
  await assert('active-progression-stop-visible',`(()=>{const button=[...document.querySelectorAll('.progression-batch button')].find(el=>el.textContent==='Parar novos envios e verificar o atual');return !!button&&button.getBoundingClientRect().height>0;})()`);
  const mutations=calls.filter(call=>/^(start|confirm|farmStart|gameAction|openLogin|removeAccount)/.test(call.method));
  checks.push({name:'no-live-operation-starts',passed:mutations.length===0});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,calls:calls.map(call=>call.method)},null,2));console.log(JSON.stringify({checks}));app.exit(checks.every(check=>check.passed)?0:1);
 }catch(error){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,error:error.message,consoleErrors,screen:await run('document.body.innerText.slice(0,3000)')},null,2));console.error(error.stack);app.exit(1);}
});
app.on('will-quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
