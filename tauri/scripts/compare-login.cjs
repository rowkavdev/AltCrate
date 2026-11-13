'use strict';

// A normal, anonymous Chromium login window for comparing browser compatibility.
// Never opens the original Electron profile, imports accounts, or submits a form.
const {app, BrowserWindow, session}=require('electron');
const {mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'casepilot-login-comparison-')));
app.setName('AltCrate Login Comparison');
app.whenReady().then(async()=>{
  const partition='persist:anonymous-comparison';
  session.fromPartition(partition).setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  const window=new BrowserWindow({width:1050,height:800,title:'AltCrate · comparação Chromium',webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{
    try{if(new URL(url).origin!=='https://case-clicker.com')event.preventDefault();}catch{event.preventDefault();}
  });
  await window.loadURL('https://case-clicker.com/auth/login');
}).catch(error=>{console.error(error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
