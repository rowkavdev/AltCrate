const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('the actual review displays automatic persistent preparation for each affected account before confirmation',()=>{
 const ts=require('../../casepilot/apps/web/node_modules/typescript'),path=require.resolve('../../casepilot/apps/web/src/components/ConverterReviewDialog.jsx'),code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const react={__esModule:true,default:{createElement:(type,props,...children)=>({type,props:props||{},children})},useMemo:fn=>fn(),useState:v=>[v,()=>{}]};
 const sandbox={exports:{},require:name=>name==='react'?react:name.includes('language')?{t:v=>v}:name.includes('format')?{formatNumber:String}:name.includes('converterViewModel')?{converterSteps:[{id:'open',label:'Abrir cápsulas'}]}:new Proxy({},{get:(_,key)=>String(key)})};vm.runInNewContext(code,sandbox);
 let confirmed=0;const rows=['a','b'].map(accountId=>({accountId,label:accountId,membership:'free',items:[],excludedItems:[],effectiveSteps:['open'],prerequisites:[{kind:'disable-autosell'}]})),nodes=[],words=[];
 function visit(node){if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){nodes.push(node);(node.children||[]).forEach(visit);}else if(node!==null&&node!==undefined)words.push(String(node));}
 visit(sandbox.exports.default({preview:{steps:['open'],config:{accountIds:['a','b']},rows},onConfirm:()=>confirmed++}));
 assert.equal(confirmed,0);assert.match(words.join(' '),/Preparação automática/);assert.match(words.join(' '),/2\s+contas/);assert.match(words.join(' '),/fica guardada no site/);assert.equal(words.filter(w=>w.includes('Primeiro: desligar')).length,2);
 const button=nodes.find(n=>n.type==='Button'&&n.children.includes('Confirmar 1 etapa'));assert.ok(button);button.props.onClick();assert.equal(confirmed,1);
});
test('a partial review cannot silently start fewer than the selected accounts',async()=>{
 const {converterStepSelection,converterSequenceScope}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const source=fs.readFileSync(require.resolve('../../casepilot/apps/web/src/pages/TokenConverterPage.jsx'),'utf8'),part=source.slice(source.indexOf('  async function prepare('),source.indexOf('  async function halt(')),events=[];
 const sandbox={eligibleSourceIds:['a','b'],steps:['open'],routing:'selected',resumeIds:[],repeatIds:[],converterStepSelection,converterSequenceScope,reviewGeneration:{current:0},setPreparationIssues:()=>{},setPreview:v=>events.push(v),setPreviewKey:()=>{},setError:()=>{},bridge:{prepareTokenConverter:async()=>({previewId:'partial',rows:[{accountId:'b'}]})},invoke:async work=>work()};vm.runInNewContext(part+';this.prepareReview=prepare;',sandbox);
 await assert.rejects(sandbox.prepareReview(),/todas|selecionad|incompleta/i);assert.equal(events.some(v=>v?.previewId),false);
});
test('opening controls distinguish conversion after every lot from conversion of existing skins',()=>{
 const ts=require('../../casepilot/apps/web/node_modules/typescript'),source=fs.readFileSync(require.resolve('../../casepilot/apps/web/src/components/ConverterStepPicker.jsx'),'utf8'),code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText,events=[];
 const steps=JSON.parse(fs.readFileSync(require.resolve('../../shared/converter-steps.json'),'utf8')),sandbox={exports:{},require:name=>name==='react'?{__esModule:true,default:{createElement:(type,props,...children)=>({type,props:props||{},children})}}:name.includes('language')?{t:v=>v}:name.includes('converterViewModel')?{converterSteps:steps}:name.includes('ConverterStepIcon')?{__esModule:true,default:'icon',stepCaptions:{}}:new Proxy({},{get:(_,key)=>String(key)})};vm.runInNewContext(code,sandbox);
 const nodes=[],words=[];function visit(node){if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){nodes.push(node);(node.children||[]).forEach(visit);}else if(typeof node==='string')words.push(node);}
 visit(sandbox.exports.default({selectedSteps:['open','convert-stickers'],routing:'selected',onChange:(ids,mode)=>events.push({ids,mode})}));
 const stream=nodes.find(n=>n.props['aria-label']==='Converter após cada lote'),existing=nodes.find(n=>n.props['aria-label']==='Converter skins existentes');assert.equal(stream.props.checked,true);assert.equal(existing.props.checked,false);assert.match(words.join(' '),/Converte cada lote antes de abrir o seguinte/);existing.props.onCheckedChange(true);assert.deepEqual([...events[0].ids],['open','convert-stickers','convert-inventory']);
});
