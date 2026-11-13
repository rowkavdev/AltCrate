module.exports=async function check(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),checks=[];
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const run=source=>win.webContents.executeJavaScript(source,true);
 const assert=(result,name)=>{if(!result)throw Error(name);checks.push(name);};
 const route=async page=>{await run(`location.hash=${JSON.stringify(page)}`);await pause(100);};
 const value=async(selector,value)=>{await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(80);};
 await pause(500);await route('inventory');
 await value('[aria-label="Conta do inventário"]','a2');await pause(450);
 assert(await run(`document.querySelector('.inventory-grid').textContent.includes('AK-47')&&!document.querySelector('.inventory-grid').textContent.includes('USP-S')`),'late first-account response cannot replace the selected inventory');
 assert(await run(`document.querySelector('.inventory-card img').naturalWidth>0`),'inventory images render inside reserved photo slots');
 assert(await run(`document.querySelector('.inventory-grid').textContent.includes('Imagem indisponível')`),'unavailable images keep an explicit fallback');
 await value('[aria-label="Pesquisar itens"]','Item de ensaio');await run(`document.querySelector('.inventory-search').requestSubmit()`);await pause(150);
 await run(`document.querySelector('.inventory-pagination button:last-child').click()`);await pause(150);
 assert(calls.filter(c=>c.method==='readInventory').at(-1).args[1]===2,'pagination asks the server for page two');
 await route('overview');await route('inventory');await pause(150);
 assert(await run(`document.querySelector('[aria-label="Conta do inventário"]').value==='a2'&&document.querySelector('[aria-label="Pesquisar itens"]').value==='Item de ensaio'&&document.querySelector('.inventory-pagination').textContent.includes('Página 2')`),'account search and page survive navigation');
 await run(`window.inventoryFixture.shrink();document.querySelector('[aria-label="Atualizar inventário"]').click()`);await pause(300);
 assert(await run(`document.querySelector('.inventory-pagination').textContent.includes('Página 1 de 1')&&document.querySelectorAll('.inventory-card').length>0`),'shrinking inventory recovers a valid populated page');
 assert(calls.filter(c=>c.method==='readInventory').at(-1).args[1]===1,'out-of-range refresh refetches the last valid page');
 await value('[aria-label="Favoritos do inventário"]','only');await pause(150);
 assert(calls.filter(c=>c.method==='readInventory').at(-1).args[1]===1,'changing favorites resets pagination');
 assert(await run(`document.querySelectorAll('.inventory-card').length===4`),'favorites display the filtered server response');
 await run(`document.querySelector('.inventory-open').focus();document.querySelector('.inventory-open').click()`);await pause(80);
 assert(await run(`document.querySelector('[role=dialog]').textContent.includes('0,123456')`),'item details show observed float');
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await pause(80);
 assert(await run(`!document.querySelector('[role=dialog]')&&document.activeElement.classList.contains('inventory-open')`),'closing details restores card focus');
 assert(!calls.some(c=>['farmStart','farmStop','gameAction','startOpening','farmSetModes'].includes(c.method)),'inventory navigation and filters send no mutations');
 for(const width of [320,390,768,1024,1440]){
  win.setContentSize(width,1000);await pause(80);
  assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'no inventory overflow at '+width+'px');
  fs.writeFileSync(path.join(out,'inventory-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 fs.writeFileSync(path.join(out,'inventory-checks.json'),JSON.stringify(checks,null,2));console.log('Inventory runtime checks: '+checks.length+' passed');
};
