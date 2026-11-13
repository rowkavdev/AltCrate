// Offline audit of every route, using an isolated profile and the fixture bridge.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const output=path.resolve(process.argv[2]||'artifacts/page-review-2026-10-14/after');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-pages-'));
app.setPath('userData',profile);
const calls=[],errors=[],layouts=[],checks=[];
ipcMain.on('fixture:call',(_,call)=>calls.push(call));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const routes=['overview','accounts','automation','opening','converter','inventory','games','rewards','skills','autoopen','diagnostics','settings','activity'];
const variantsOnly=process.argv.includes('--variants');
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(__dirname,'fixtures/casepilot-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,additionalArguments:['--cp-count=100','--cp-state=idle']}});
 win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('ERR_BLOCKED_BY_CLIENT'))errors.push(event.message);});
 const run=source=>win.webContents.executeJavaScript(source);
 async function capture(name,width){
  win.setContentSize(width,1000);await delay(100);
  const metrics=await run(`(()=>{
   const selector=el=>el.tagName.toLowerCase()+'.'+[...el.classList].join('.');
   const overflow=[...document.querySelectorAll('.page-body *')].filter(el=>{
    const r=el.getBoundingClientRect();if(!r.width||!r.height||r.right<=innerWidth+1)return false;
    for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){if(['auto','scroll','hidden','clip'].includes(getComputedStyle(p).overflowX))return false;}return true;
   }).slice(0,12).map(el=>({element:selector(el),text:el.textContent.slice(0,100)}));
   return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,route:location.hash,overflow,title:document.querySelector('h1')?.textContent,panels:document.querySelectorAll('.page-body .panel').length};
  })()`);
  layouts.push({name,width,...metrics});
  if(width===390||width===1440)fs.writeFileSync(path.join(output,name+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 try{
  // Enable the optional route in the fixture only.
  await win.loadFile(path.resolve('dist/index.html'),{hash:'settings'});await delay(700);
  await run(`document.querySelector('.optional-feature-choice input').click()`);await delay(150);
  if(!variantsOnly){
  for(const route of routes){
   await run(`location.hash=${JSON.stringify(route)}`);await delay(route==='games'?800:650);
   for(const width of [320,390,768,1024,1440])await capture(route,width);
   if(route==='rewards')for(const tab of ['missions','pass']){
    await run(`document.querySelectorAll('[role=tab]')[${tab==='missions'?1:2}].click()`);await delay(200);
    for(const width of [320,768,1440])await capture('rewards-'+tab,width);
   }
   if(route==='inventory'){
    await run(`document.querySelector('[aria-label="Ver storages"]').click()`);await delay(500);
    for(const width of [320,768,1440])await capture('storages',width);
   }
   if(route==='skills'){
    await run(`document.querySelector('.skill-map-node').click()`);await delay(150);
    checks.push({name:'skill-link-preserves-route',passed:await run(`location.hash==='#skills'`)});
    await run(`location.hash='skills'`);await delay(100);
   }
  }
  await run(`location.hash='accounts'`);await delay(150);
  await run(`document.querySelector('[aria-label="Pesquisar contas"]').focus()`);
  await win.webContents.insertText('Conta 100');await delay(150);
  checks.push({name:'last-account-search',passed:await run(`document.querySelectorAll('.account-list .account-row').length===1&&document.querySelector('.account-list .account-row').textContent.includes('Conta 100')`)});
  win.setContentSize(390,1000);await delay(100);
  await run(`document.querySelector('.menu-trigger').click()`);await delay(100);
  checks.push({name:'mobile-menu-focus',passed:await run(`document.querySelector('.sidebar').contains(document.activeElement)`)});
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(100);
  checks.push({name:'mobile-menu-escape',passed:await run(`!document.querySelector('.sidebar.is-open')&&document.activeElement===document.querySelector('.menu-trigger')`)});
  }else{
   for(const variant of ['dark','english','zoom']){
    await run(`location.hash='settings'`);await delay(400);
    if(variant==='dark')await run(`document.querySelector('.theme-toggle').click()`);
    if(variant==='english')await run(`(()=>{document.querySelector('.theme-toggle').click();const select=document.querySelector('#app-language');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    if(variant==='zoom')win.webContents.setZoomFactor(1.5);
    for(const route of routes){
     await run(`location.hash=${JSON.stringify(route)}`);await delay(route==='games'?800:500);
     for(const width of variant==='dark'?[390,1440]:variant==='english'?[320]:[1440])await capture(variant+'-'+route,width);
    }
   }
   checks.push({name:'english-language-selected',passed:await run(`document.documentElement.lang==='en-GB'||document.documentElement.lang==='en'`)});
  }
  const mutations=calls.filter(call=>/^(start|confirm|farmStart|gameAction|openLogin|removeAccount)/.test(call.method));
  checks.push({name:'no-game-mutations',passed:mutations.length===0});
  const report={layouts,checks,errors,calls:calls.map(call=>call.method)};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  const failed=layouts.filter(item=>item.scroll>item.viewport+1||item.overflow.length);
  console.log(JSON.stringify({views:layouts.length,overflow:failed.map(item=>({name:item.name,width:item.width,overflow:item.overflow})),checks,errors}));
  app.exit(failed.length||checks.some(check=>!check.passed)||errors.length?1:0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
app.on('will-quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
