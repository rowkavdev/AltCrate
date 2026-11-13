const {app,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),archive=path.join(root,'release-inventory-management/mac-arm64/CasePilot.app/Contents/Resources/app.asar');
process.env.CASE_CLICKER_TEST_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-inventory-boot-'));
const out=path.join(root,'artifacts/inventory-management-2026-10-14');
const timer=setTimeout(()=>{console.error('Packaged inventory boot timed out');app.exit(1);},30000);
app.on('browser-window-created',(_event,win)=>{
 win.hide();win.webContents.once('did-finish-load',async()=>{
  try{
   const result=await win.webContents.executeJavaScript(`(async()=>{const b=window.caseClicker;const methods=['prepareInventoryBatch','startInventoryBatch','stopInventoryBatch','verifyInventoryBatch','resumeInventoryBatch','listInventoryBatches','prepareStorageManagement','confirmStorageManagement','verifyStorageManagement','listStorageManagement'];const available=methods.every(name=>typeof b[name]==='function');const batches=await b.listInventoryBatches(),storages=await b.listStorageManagement();let rejectedInvalidAccount=false;try{await b.prepareStorageManagement({kind:'create',accountId:'missing'});}catch{rejectedInvalidAccount=true;}location.hash='inventory';return {available,batches,storages,rejectedInvalidAccount};})()`);
   assert.equal(result.available,true);assert.deepEqual(result.batches,[]);assert.deepEqual(result.storages,[]);assert.equal(result.rejectedInvalidAccount,true);
   await new Promise(resolve=>setTimeout(resolve,200));
   assert.equal(await win.webContents.executeJavaScript(`document.body.textContent.includes('Inventário')`),true);
   fs.writeFileSync(path.join(out,'packaged-boot.json'),JSON.stringify({...result,isolatedAccounts:true,version:require(archive+'/package.json').version},null,2));
   console.log('Packaged inventory and storage bridge checks passed');clearTimeout(timer);app.exit(0);
  }catch(error){console.error(error.stack);clearTimeout(timer);app.exit(1);}
 });
});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true})));
require(archive+'/electron/main.cjs');
