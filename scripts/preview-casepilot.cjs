const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const arg=(name,fallback)=>{const value=process.argv.find(item=>item.startsWith('--'+name+'='));return value?value.split('=').slice(1).join('='):fallback;};
const out=path.resolve(arg('output','artifacts/casepilot-v0.3.0'));fs.mkdirSync(out,{recursive:true});
const width=Number(arg('width','1440')),height=Number(arg('height','1000')),count=Number(arg('accounts','1')),state=arg('state','idle'),page=arg('page','overview');
app.setName('AltCrate Preview');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-preview-')));
const calls=[];ipcMain.on('fixture:call',(_,call)=>{calls.push(call);fs.writeFileSync(path.join(out,'preview-calls.json'),JSON.stringify(calls,null,2));});
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 let skillPresets;
 if(arg('skill-presets-check','')==='yes'){const raw=require('../tests/fixtures/auto-skill-v17.json'),presets=require('../electron/skillPresets.json'),{summarizePresets}=require('../electron/skillPresetSummary.cjs');const states=Object.entries(raw).map(([name,skills])=>({map:{name,skills,requiredRankId:0,requiredPremierId:null},ownedIds:[],rank:20,premierRank:0}));skillPresets=summarizePresets(presets,states,{money:10000000,skillPoints:54,casesPerClick:1,moneyPerClick:0.1,vaultCapacity:10,vaultMoneyPerMinute:1,caseOpenCount:1,maxCaseOpenMultiplier:1});}
 const win=new BrowserWindow({width,height,useContentSize:true,show:arg('hidden','')!=='yes',title:'AltCrate Preview',backgroundColor:'#101114',webPreferences:{preload:path.join(__dirname,'fixtures/casepilot-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,additionalArguments:['--cp-count='+count,'--cp-state='+state,'--cp-farm-check='+arg('farm-check',''),...(skillPresets?['--cp-skill-presets='+JSON.stringify(skillPresets)]:[])]}});
 win.webContents.on('console-message',event=>{if(event.level==='error')fs.appendFileSync(path.join(out,'preview-console.log'),event.message+'\n');});
 await win.loadFile(path.resolve('dist/index.html'),{hash:page});
 if(arg('skill-presets-check','')==='yes'){try{await require('./check-casepilot-skill-presets.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('reliability-check','')==='yes'){try{await require('./check-casepilot-reliability.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('inventory-management-check','')==='yes'){try{await require('./check-casepilot-inventory-management.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('server-check','')==='yes'){try{await require('./check-casepilot-server.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('progression-check','')==='yes'){try{await require('./check-casepilot-progression.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('converter-check','')==='yes'){try{await require('./check-casepilot-token-converter.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('opening-rules-check','')==='yes'){try{await require('./check-casepilot-opening-rules.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('storage-move-check','')==='yes'){try{await require('./check-casepilot-storage-move.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('inventory-actions-check','')==='yes'){try{await require('./check-casepilot-inventory-actions.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 const zoom=Number(arg('zoom','1'));win.webContents.setZoomFactor(zoom);
 if(arg('storage-check','')==='yes'){try{await require('./check-casepilot-storage.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('inventory-check','')==='yes'){try{await require('./check-casepilot-inventory.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('farm-check','')==='yes'){try{await require('./check-casepilot-farm.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('selftest','')==='yes'){try{await require('./casepilot-runtime-check.cjs')(win,calls,out);app.quit();}catch(error){console.error(error.stack);app.exit(1);}return;}
 if(arg('capture','')==='yes')setTimeout(async()=>{
  const name=page+'-'+width+'-'+state+(zoom!==1?'-zoom'+zoom:'');
  const metrics=await win.webContents.executeJavaScript(`({viewport:innerWidth,scroll:document.documentElement.scrollWidth,page:location.hash,rows:document.querySelectorAll('.farm-row').length,cards:document.querySelectorAll('.game-card').length,errors:[...document.querySelectorAll('.inline-error')].map(x=>x.textContent),farmWidth:document.querySelector('.farm-scroll')?.getBoundingClientRect().width,farmVariant:document.querySelector('.farm-scroll')?.className})`);
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({accounts:count,state,width,height,zoom,...metrics},null,2));
  fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());if(metrics.farmWidth<760&&metrics.farmVariant?.includes('layout-row')){console.error('FAIL: narrow farm started with desktop rows');app.exit(1);}else app.quit();
 },Number(arg('wait','1600')));
 win.on('closed',()=>app.quit());
});
