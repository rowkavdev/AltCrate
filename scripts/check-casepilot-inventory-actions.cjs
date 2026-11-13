module.exports=async function check(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),checks=[];
 const run=source=>win.webContents.executeJavaScript(source,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const assert=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);};
 const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(120);};
 const value=async(selector,value)=>{await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(120);};
 await run(`location.hash='inventory'`);await pause(600);
 assert(await run(`!!document.querySelector('.inventory-actions-trigger')`),'each inventory item has an Actions button');
 assert(await run(`!!document.querySelector('.item-accessories img')`),'attached accessories display photographs');
 await run(`document.querySelector('.inventory-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:innerWidth-2,clientY:innerHeight-2}))`);await pause(80);
 assert(await run(`!!document.querySelector('[role=menu]')`),'right click opens item menu');
 for(const width of [320,390,768,1024,1440]){win.setContentSize(width,900);await pause(100);assert(await run(`(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`),'menu fits '+width+'px');fs.writeFileSync(path.join(out,'item-menu-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await pause(50);
 assert(await run(`!document.querySelector('[role=menu]')`),'Escape closes context menu');
 await run(`document.querySelector('.inventory-open').focus();document.querySelector('.inventory-open').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))`);await pause(50);
 assert(await run(`!!document.querySelector('[role=menu]')`),'Shift F10 opens equivalent menu');
 await click('[data-action=transfer]');await value('[aria-label="Pesquisar conta de destino"]','Conta 100');
 assert(await run(`document.querySelector('[aria-label="Conta de destino"]').options.length===2`),'100 account destination selector is searchable');
 await value('[aria-label="Conta de destino"]','a100');await click('[data-action=review-transfer]');await pause(250);
 assert(await run(`document.querySelector('[role=dialog]').textContent.includes('Conta 100')`),'transfer review binds chosen destination');
 assert(!calls.some(c=>c.method==='confirmInventoryAction'),'review sends no mutation before confirmation');
 assert(!calls.some(c=>c.method==='readInventory'&&c.args[0]==='a100'),'destination chooser does not load target inventory');
 for(const width of [320,390,768,1024,1440]){win.setContentSize(width,900);await pause(80);await run(`document.querySelector('.inventory-action-review').scrollTop=10000`);assert(await run(`(()=>{const b=document.querySelector('[data-action=confirm]').getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`),'review confirmation reachable '+width+'px');fs.writeFileSync(path.join(out,'item-review-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
 await run(`document.querySelector('[data-action=confirm]').click();document.querySelector('[data-action=confirm]')?.click()`);await pause(300);
 assert(calls.filter(c=>c.method==='confirmInventoryAction').length===1,'double confirmation sends only one request');
 await click('[aria-label="Fechar revisão"]');await run(`location.hash='activity'`);await pause(100);assert(await run(`document.body.textContent.includes('Envio')`),'action results appear in activity');
 await run(`location.hash='inventory'`);await pause(150);assert(await run(`document.querySelector('.inventory-operations').textContent.includes('A confirmar chegada')`),'operation survives navigation');
 // A deliberately delayed preview must not reappear in a newly selected account.
 await click('.inventory-card:nth-child(2) .inventory-actions-trigger');await click('[data-action=sell]');
 assert(calls.at(-1)?.method==='prepareInventoryAction','late response test starts a real sale preview request');
 await value('[aria-label="Conta do inventário"]','a2');await pause(450);
 assert(await run(`!document.querySelector('.inventory-action-review')`),'late preview cannot replace the selected account');
 await value('[aria-label="Favoritos do inventário"]','only');await pause(200);
 const favoriteName=await run(`document.querySelector('.inventory-open').getAttribute('aria-label')`);
 await click('.inventory-actions-trigger');await click('[data-action=favorite]');await pause(260);await click('[data-action=confirm]');await pause(350);await click('[aria-label="Fechar revisão"]');
 assert(await run(`![...document.querySelectorAll('.inventory-open')].some(el=>el.getAttribute('aria-label')===${JSON.stringify(favoriteName)})`),'removing favorite refreshes the current favorite filter');
 await click('[aria-label="Ver storages"]');await pause(450);await click('[aria-label="Ver storage Arquivo a2"]');await pause(350);await click('.inventory-actions-trigger');await click('[data-action=withdraw]');await pause(350);
 assert(await run(`document.querySelector('[role=dialog]').textContent.includes('Retirar do storage')`),'storage action reviews withdrawal');
 await click('[data-action=confirm]');await pause(500);await click('[aria-label="Fechar revisão"]');await pause(350);
 assert(await run(`document.querySelector('.storage-content').textContent.includes('200 itens guardados')`),'withdrawal refreshes storage count');
 assert(!calls.some(c=>['farmStart','farmStop','gameAction','startOpening'].includes(c.method)),'inventory actions check does not start unrelated operations');
 fs.writeFileSync(path.join(out,'inventory-actions-checks.json'),JSON.stringify(checks,null,2));console.log('Inventory actions runtime checks: '+checks.length+' passed');
};
