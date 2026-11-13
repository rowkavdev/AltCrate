const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-overlays-'));
const output=path.resolve('artifacts/page-review-2026-10-14/overlays');
app.setPath('userData',profile);
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({show:false,width:390,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,preload:path.join(__dirname,'fixtures/casepilot-preload.cjs'),additionalArguments:['--cp-count=100','--cp-state=idle']}});
 const run=source=>win.webContents.executeJavaScript(source),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[];
 fs.mkdirSync(output,{recursive:true});
 async function check(name,selector){
  const bounds=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,viewportWidth:document.documentElement.clientWidth,viewportHeight:innerHeight};})()`);
  checks.push({name,...bounds,passed:Math.abs(bounds.left)<1&&Math.abs(bounds.top)<1&&Math.abs(bounds.width-bounds.viewportWidth)<1&&Math.abs(bounds.height-bounds.viewportHeight)<1});
  fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 try{
  await win.loadFile(path.resolve('dist/index.html'),{hash:'accounts'});await delay(1000);
  await run(`[...document.querySelectorAll('.account-list .account-row button')].find(button=>button.textContent==='Detalhes').click()`);await delay(100);
  await check('account-details','.detail-scrim');
  await run(`document.querySelector('[aria-label="Fechar detalhes"]').click();location.hash='inventory'`);await delay(850);
  await run(`document.querySelector('.inventory-actions-trigger').click()`);await delay(100);
  await check('inventory-menu','.inventory-menu-scrim');
  await run(`document.querySelector('[data-action="details"]').click()`);await delay(100);
  await check('item-details','.detail-scrim');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
  app.exit(checks.every(check=>check.passed)?0:1);
 }catch(error){console.error(error.stack);app.exit(1);}
});
app.on('will-quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
