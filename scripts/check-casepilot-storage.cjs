module.exports=async function check(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),checks=[];
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const run=source=>win.webContents.executeJavaScript(source,true);
 const assert=(result,name)=>{if(!result)throw Error(name);checks.push(name);};
 const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(80);};
 const value=async(selector,value)=>{await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(80);};
 const route=async page=>{await run(`location.hash=${JSON.stringify(page)}`);await pause(100);};
 await pause(500);await route('inventory');
 assert(await run(`!!document.querySelector('[aria-label="Ver storages"]')`),'inventory exposes storages for the selected account');
 await click('[aria-label="Ver storages"]');await value('[aria-label="Conta do inventário"]','a2');await pause(450);
 assert(await run(`document.querySelector('.storage-grid').textContent.includes('Arquivo a2')&&!document.querySelector('.storage-grid').textContent.includes('Arquivo a1')`),'late account response cannot replace another account storage list');
 await value('[aria-label="Conta do inventário"]','a1');await value('[aria-label="Conta do inventário"]','a2');await pause(450);
 assert(await run(`!document.querySelector('[aria-label="Atualizar storages"]').disabled&&!document.querySelector('[role=alert]')`),'returning to a cached account cancels the other account loading state');
 await click('[aria-label="Ver storage Arquivo a2"]');await click('[aria-label="Todos os storages"]');await click('[aria-label="Ver storage Vazio a2"]');await pause(450);
 assert(await run(`document.querySelector('.storage-content').textContent.includes('Este storage está vazio')&&!document.querySelector('.storage-content').textContent.includes('AK-47')`),'late storage response cannot overwrite an empty selected storage');
 await click('[aria-label="Todos os storages"]');await click('[aria-label="Ver storage Arquivo a2"]');await pause(400);
 assert(await run(`document.querySelector('.inventory-card img').naturalWidth>0`),'stored items display images in the shared gallery');
 await click('.inventory-pagination button:last-child');await pause(400);
 assert(calls.filter(c=>c.method==='readStorageInventory').at(-1).args[2]===2,'storage pagination reads the next server page');
 await value('[aria-label="Pesquisar itens no storage"]','Item');await run(`document.querySelector('.storage-search').requestSubmit()`);await pause(400);
 assert(calls.filter(c=>c.method==='readStorageInventory').at(-1).args[2]===1&&calls.filter(c=>c.method==='readStorageInventory').at(-1).args[3].search==='Item','storage search resets pagination and sends the filter');
 await value('[aria-label="Ordenação do storage"]','price');await pause(400);
 assert(calls.filter(c=>c.method==='readStorageInventory').at(-1).args[3].sort==='price','storage ordering reaches the read request');
 await route('overview');await route('inventory');await pause(100);
 assert(await run(`document.querySelector('[aria-label="Conta do inventário"]').value==='a2'&&document.querySelector('[aria-label="Pesquisar itens no storage"]').value==='Item'&&document.querySelector('.storage-content').textContent.includes('Arquivo a2')`),'storage account selection and filters survive page navigation');
 await run(`document.querySelector('.inventory-open').focus();document.querySelector('.inventory-open').click()`);await pause(80);
 assert(await run(`document.querySelector('[role=dialog]').textContent.includes('0,123456')`),'storage items reuse photograph and observed details');
 for(const width of [320,390,768,1024,1440]){win.setContentSize(width,1000);await pause(80);assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'no storage details overflow at '+width+'px');}
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await pause(80);
 assert(await run(`!document.querySelector('[role=dialog]')&&document.activeElement.classList.contains('inventory-open')`),'storage details restore keyboard focus');
 for(const width of [320,390,768,1024,1440]){win.setContentSize(width,1000);await pause(80);assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'no stored inventory overflow at '+width+'px');fs.writeFileSync(path.join(out,'storage-items-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
 await click('[aria-label="Todos os storages"]');
 for(const width of [320,390,768,1024,1440]){win.setContentSize(width,1000);await pause(80);assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'no storage list overflow at '+width+'px');fs.writeFileSync(path.join(out,'storages-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
 await value('[aria-label="Conta do inventário"]','a3');await pause(120);assert(await run(`document.querySelector('.storage-browser').textContent.includes('Esta conta ainda não tem storages')`),'accounts without storage show their own empty state');
 await value('[aria-label="Conta do inventário"]','a4');await pause(120);assert(await run(`document.querySelector('[role=alert]').textContent.includes('HTTP 503')`),'storage failures remain visible and recoverable');
 await click('[aria-label="Atualizar storages"]');await pause(120);assert(await run(`document.querySelector('.storage-grid').textContent.includes('Arquivo a4')&&!document.querySelector('[role=alert]')`),'refresh recovers a failed storage list');
 assert(!calls.some(c=>['farmStart','farmStop','gameAction','startOpening','farmSetModes'].includes(c.method)),'storage inspection sends no account mutations');
 fs.writeFileSync(path.join(out,'storage-checks.json'),JSON.stringify(checks,null,2));console.log('Storage runtime checks: '+checks.length+' passed');
};
