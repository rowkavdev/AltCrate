const {app,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const archive=path.join(process.env.CASEPILOT_PACKAGED_APP||path.join(root,'release-token-converter/mac-arm64/CasePilot.app'),'Contents/Resources/app.asar');
process.env.CASE_CLICKER_TEST_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-converter-boot-'));
const out=process.env.CASEPILOT_PACKAGED_OUTPUT||path.join(root,'artifacts/token-converter');fs.mkdirSync(out,{recursive:true});
const timer=setTimeout(()=>{console.error('Packaged converter boot timed out');app.exit(1);},30000);
app.on('browser-window-created',(_event,win)=>{
  win.hide();
  win.webContents.once('did-finish-load',async()=>{
    try {
      const result=await win.webContents.executeJavaScript(`(async()=>{const state=await window.caseClicker.getTokenConverterStatus();let rejectsEmpty=false;try{await window.caseClicker.startTokenConverter({action:'full',accountIds:[],destinationAccountId:'none'});}catch{rejectsEmpty=true;}location.hash='#converter';return {state,rejectsEmpty};})()`);
      assert.equal(result.state.phase,'idle');assert.deepEqual(result.state.rows,[]);assert.equal(result.rejectsEmpty,true);
      await new Promise(r=>setTimeout(r,250));
      assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('.converter-page')&&document.querySelector('.converter-run .primary-button').disabled`),true);
      fs.writeFileSync(path.join(out,'packaged-boot.json'),JSON.stringify({...result,isolatedAccounts:true,version:require(archive+'/package.json').version},null,2));
      console.log('Packaged converter boot and native bridge passed');clearTimeout(timer);app.exit(0);
    }catch(e){console.error(e.stack);clearTimeout(timer);app.exit(1);}
  });
});
app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['https://case-clicker.com/*','https://ws.case-clicker.com/*']},(_request,callback)=>callback({cancel:true}));});
require(archive+'/electron/main.cjs');
