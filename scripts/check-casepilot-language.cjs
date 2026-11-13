// Offline smoke check of the built app with fixture accounts and no network access.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-language-'));
app.setPath('userData',profile);
const output=path.resolve('artifacts/language-2026-10-14');fs.mkdirSync(output,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{preload:path.join(__dirname,'fixtures/casepilot-preload.cjs'),contextIsolation:true,sandbox:true,additionalArguments:['--cp-count=2','--cp-state=idle']}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 const js=code=>win.webContents.executeJavaScript(code),checks=[];
 const navigate=async page=>{await js(`document.querySelector('a[href="#${page}"]').click()`);await delay(100);};
 const choose=async value=>{await js(`const select=document.getElementById('app-language');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));`);await delay(100);};
 try{
  await win.loadFile(path.resolve('dist/index.html'));await delay(500);
  await navigate('accounts');
  await js(`const input=document.querySelector('.search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Preserve me');input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await navigate('settings');await js(`document.querySelector('.optional-feature-choice input').click()`);await delay(100);assert.equal(await js('document.getElementById("app-language").value'),'pt');
  await choose('en');assert.equal(await js('document.documentElement.lang'),'en-GB');assert.equal(await js('document.querySelector("h1").textContent'),'Settings');assert.equal(await js('document.querySelector(".page-heading p").textContent'),'Language and optional app features.');checks.push('language switches immediately');
  fs.writeFileSync(path.join(output,'settings-en-1440.png'),(await win.webContents.capturePage()).toPNG());
  const pages={overview:'Overview',accounts:'Accounts',automation:'Automation',opening:'Open cases',converter:'Token converter',inventory:'Inventory',games:'Games',rewards:'Rewards',skills:'Skill maps',autoopen:'Opening preferences',diagnostics:'Diagnostics',activity:'Activity',settings:'Settings'};
  for(const [page,title] of Object.entries(pages)){await navigate(page);assert.equal(await js('document.querySelector("h1").textContent'),title);if(page==='accounts')assert.equal(await js('document.querySelector(".search").value'),'Preserve me');}
  checks.push('all 13 pages have English navigation and headings','account search preserved');
  await win.webContents.reload();await delay(500);assert.equal(await js('document.getElementById("app-language").value'),'en');assert.equal(await js('document.querySelector("h1").textContent'),'Settings');checks.push('language persists after reload');
  win.setContentSize(390,844);await delay(100);assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));fs.writeFileSync(path.join(output,'settings-en-390.png'),(await win.webContents.capturePage()).toPNG());checks.push('settings fits narrow window');
  await choose('pt');assert.equal(await js('document.querySelector("h1").textContent'),'Definições');assert.equal(await js('document.documentElement.lang'),'pt-PT');checks.push('Portuguese restored');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
 }catch(error){console.error(error.stack);process.exitCode=1;}
 finally{win.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
