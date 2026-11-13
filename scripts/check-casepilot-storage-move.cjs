module.exports=async function check(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),checks=[];
 const run=source=>win.webContents.executeJavaScript(source,true),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const assert=(condition,name)=>{if(!condition)throw Error(name);checks.push(name);};
 await run(`location.hash='inventory'`);await pause(650);
 await run(`document.querySelector('.inventory-actions-trigger').click()`);await pause(60);
 await run(`document.querySelector('[data-action="move-to-storage"]').click()`);await pause(700);
 assert(await run(`document.querySelector('[role="dialog"]')?.textContent.includes('Escolher storage de destino')`),'storage picker opens');
 assert(await run(`!!document.querySelector('[data-account="a1"][data-storage="a1-archive"]')`),'source account storage appears');
 assert(await run(`!!document.querySelector('[data-account="a2"][data-storage="a2-archive"]')`),'another account storage appears');
 assert(await run(`document.querySelector('[role="dialog"]').textContent.includes('Esta conta não tem storages.')`),'empty account is visible');
 assert(await run(`document.querySelector('[role="dialog"]').textContent.includes('1 contas não puderam ser consultadas')`),'one account failure stays visible');
 assert(!calls.some(call=>call.method==='confirmInventoryAction'),'opening picker never moves an item');
 for(const width of [390,1024]){
  win.setContentSize(width,900);await pause(100);
  assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'picker fits '+width+'px');
  fs.writeFileSync(path.join(out,'storage-move-picker-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await run(`document.querySelector('[data-account="a2"][data-storage="a2-archive"]').click()`);await pause(350);
 assert(await run(`document.querySelector('[role="dialog"]')?.textContent.includes('Conta 2')`),'review names destination account');
 assert(await run(`document.querySelector('[role="dialog"]')?.textContent.includes('Arquivo a2')`),'review names destination storage');
 assert(await run(`!!document.querySelector('[data-action="confirm"]')`),'review has explicit confirmation');
 assert(!calls.some(call=>call.method==='confirmInventoryAction'),'review never moves an item');
 fs.writeFileSync(path.join(out,'storage-move-review.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('[aria-label="Fechar revisão"]').click()`);await pause(100);
 assert(!calls.some(call=>call.method==='confirmInventoryAction'),'closing review leaves item untouched');
 fs.writeFileSync(path.join(out,'storage-move-checks.json'),JSON.stringify(checks,null,2));
 console.log('Storage move runtime checks: '+checks.length+' passed');
};
