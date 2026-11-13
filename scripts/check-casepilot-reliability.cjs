module.exports=async function(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=source=>win.webContents.executeJavaScript(source,true),checks=[];
 await wait(800);
 await js(`(async()=>{const s=await window.caseClicker.farmStatus(),now=Date.now();window.farmFixture.emit({type:'request',status:{...s,phase:'running',accounts:s.accounts.map(a=>({...a,selected:true,performance:{measuredAt:now,lastCaseAt:now-10000,observedSeconds5:300,observedSeconds30:1800,casesPerMinute5:10,casesPerMinute30:12,cases5:50,cases30:360}}))}});})()`);await wait(150);
 assert.match(await js(`document.querySelector('.farm-performance').textContent`),/510/);checks.push('summary adds confirmed per-account rates');
 assert.equal(calls.filter(c=>['farmStart','farmSetModes'].includes(c.method)).length,0);checks.push('viewing metrics performs no mutations');
 for(const language of ['pt','en']){
  await js(`document.querySelector('a[href="#settings"]').click()`);await wait(100);
  await js(`(()=>{const el=document.getElementById('app-language');el.value=${JSON.stringify(language)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);
  await js(`document.querySelector('a[href="#automation"]').click()`);await wait(100);
  for(const width of [1440,768,320]){
   win.setContentSize(width,1000);await wait(180);
   const result=await js(`({width:innerWidth,scroll:document.documentElement.scrollWidth,rowOverflow:[...document.querySelectorAll('.farm-row')].some(r=>r.scrollHeight>r.clientHeight+2),text:document.querySelector('.farm-performance').textContent})`);
   assert.ok(result.scroll<=result.width,JSON.stringify(result));assert.equal(result.rowOverflow,false,'farm rows clip at '+width);assert.match(result.text,language==='en'?/cases\/min/:/caixas\/min/);
   fs.writeFileSync(path.join(out,'performance-'+language+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());checks.push(language+' metrics fit '+width);
  }
 }
 await js(`document.querySelector('.farm-configuration summary').click()`);await wait(100);
 const label='Prioritise cases and vault';await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(700);
 const modes=calls.filter(c=>c.method==='farmSetModes');assert.equal(modes.length,51);assert.ok(modes.every(c=>c.args[1].case===true&&c.args[1].money===false&&c.args[1].vault===true));assert.equal(calls.filter(c=>c.method==='farmStart').length,0);checks.push('priority configures selected accounts exactly once without starting');
 await js(`(async()=>{const s=await window.caseClicker.farmStatus();window.farmFixture.emit({type:'account-error',status:{...s,execution:{kind:'server',connected:false,name:'Own server',updatedAt:Date.now()-100000}}});})()`);await wait(100);
 assert.match(await js(`document.querySelector('.farm-performance').textContent`),/Last measurement/);assert.equal(await js(`document.querySelector('.farm-stalled')===null`),true);checks.push('disconnected server shows stale measurements without false alerts');
 fs.writeFileSync(path.join(out,'ui-checks.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({checks:checks.length}));
};
