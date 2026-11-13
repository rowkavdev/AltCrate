const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const profile=path.join(path.dirname(process.argv[2]),'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
 win.webContents.on('console-message',event=>process.stderr.write(String(event.message)+'\n'));
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 try{await win.loadFile(process.argv[2]);const report=await win.webContents.executeJavaScript('window.runExpansionChecks()');report.layouts=[];for(const width of [320,390,768,1440]){win.setContentSize(width,900);report.layouts.push(...await win.webContents.executeJavaScript('window.runExpansionLayoutChecks('+width+')'));}if(process.env.CASEPILOT_SCREENSHOT_DIR){await win.webContents.executeJavaScript('window.showExpansionPreview()');win.setContentSize(390,900);await new Promise(r=>setTimeout(r,50));fs.mkdirSync(process.env.CASEPILOT_SCREENSHOT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.CASEPILOT_SCREENSHOT_DIR,'recolhas-390.png'),(await win.webContents.capturePage()).toPNG());}process.stdout.write(JSON.stringify(report)+'\n');}
 catch(error){process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;}
 finally{win.destroy();app.exit(process.exitCode||0);}
});
app.on('will-quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
