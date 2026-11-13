module.exports=async function(win,calls,out){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),checks=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true);
 const until=async code=>{for(let i=0;i<40;i++){if(await js(code))return;await wait(100);}throw Error('Timed out: '+code);};
 const click=async selector=>{await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(100);};
 await until(`document.querySelectorAll('.skill-preset-card').length===5`);
 assert.ok(calls.some(c=>c.method==='listSkillPresets'&&c.args[0]==='a1'));assert.equal(calls.some(c=>['confirmProgression','prepareProgression'].includes(c.method)),false);checks.push('all five presets shown with account-scoped read-only comparison');
 assert.match(await js(`document.querySelector('.skill-preset-card').textContent`),/25,50 p.p./);checks.push('card shows skill bonus without assuming the script default');
 await click('.skill-preset-card button');await until(`document.querySelector('.skill-preset-projection').textContent.includes('26,5')`);
 assert.equal(await js(`document.querySelector('.skill-preset-selection input').checked`),false);checks.push('choosing a build never enables an implicit reset');
 await click('.skill-preset-selection>button');await until(`Boolean(document.querySelector('[role="dialog"]'))`);assert.equal(calls.filter(c=>c.method==='prepareProgression').at(-1).args[2].reset,false);assert.equal(calls.some(c=>c.method==='confirmProgression'),false);checks.push('review is required and no purchase or sale is sent');
 await click('[aria-label="Fechar revisão"]');await click('.skill-preset-selection input');await click('.skill-preset-selection>button');await until(`Boolean(document.querySelector('[role="dialog"]'))`);assert.equal(calls.filter(c=>c.method==='prepareProgression').at(-1).args[2].reset,true);await click('[aria-label="Fechar revisão"]');checks.push('a reset must be chosen explicitly before review');
 await click('.skill-preset-card:nth-child(4) button');assert.equal(await js(`document.querySelector('.skill-preset-selection input').checked`),false);checks.push('switching goals clears reset selection');
 for(const language of ['pt','en']){
  await click('a[href="#settings"]');await until(`Boolean(document.querySelector('#app-language'))`);await js(`(()=>{const el=document.getElementById('app-language');el.value=${JSON.stringify(language)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(100);await click('a[href="#skills"]');await until(`document.querySelectorAll('.skill-preset-card').length===5`);
  for(const width of [1440,768,320]){win.setContentSize(width,1000);await wait(120);const layout=await js(`({viewport:innerWidth,width:document.documentElement.scrollWidth,heading:document.querySelector('.skill-presets h3').textContent})`);assert.ok(layout.width<=layout.viewport,JSON.stringify(layout));assert.equal(layout.heading,language==='en'?'Presets by goal':'Presets por objetivo');if(language==='en')assert.doesNotMatch(await js(`document.querySelector('.skill-presets').textContent`),/Custo completo|Em falta nesta conta|Geração do cofre/);await js(`document.querySelector('.skill-presets').scrollIntoView({block:'start'})`);fs.writeFileSync(path.join(out,'presets-'+language+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());checks.push(language+' presets fit '+width);}
 }
 assert.equal(calls.some(c=>c.method==='confirmProgression'),false);checks.push('language and layout checks never apply a build');
 fs.writeFileSync(path.join(out,'ui-checks.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({checks:checks.length}));
};
