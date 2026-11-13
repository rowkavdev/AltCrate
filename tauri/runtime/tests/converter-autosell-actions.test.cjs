const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {consolidationFixture}=require('./helpers/consolidation-fixture.cjs');
const {registerTokenConverterIpc}=require('../engine/tokenConverterIpc.cjs');
test('autosell becomes reviewed preparation for the affected account with no game mutations',async t=>{
 const f=await consolidationFixture(t,{autosell:true,capsules:2,noItems:true}),handlers=new Map();
 registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:f.service,validateSender:()=>{}});
 const result=await handlers.get('converter:prepare')({}, {action:'sequence',independent:true,accountIds:['source'],steps:['open','convert-stickers']});
 assert.ok(result.previewId);assert.equal(result.rows[0].prerequisites[0].kind,'disable-autosell');assert.equal(result.rows[0].accountId,'source');assert.equal(result.rows[0].label,'Origem');
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);assert.equal(f.openingPolicies.source.autosellActivated,true);
});
test('unexpected preparation failures still fail normally rather than returning a false review',async()=>{
 const handlers=new Map();registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:{prepare:async()=>{throw Error('network unavailable');}},validateSender:()=>{}});
 await assert.rejects(handlers.get('converter:prepare')({},{}),/network unavailable/);
});
test('the page shows actionable issues instead of opening an empty conversion preview',async()=>{
 const {converterStepSelection,converterSequenceScope}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const source=fs.readFileSync(require.resolve('../../casepilot/apps/web/src/pages/TokenConverterPage.jsx'),'utf8'),fn=source.slice(source.indexOf('  async function prepare('),source.indexOf('  async function halt('));
 const issue={code:'autosell',accountId:'source',label:'Origem'},events=[],sandbox={eligibleSourceIds:['source'],steps:['open'],routing:'selected',resumeIds:[],repeatIds:[],converterStepSelection,converterSequenceScope,reviewGeneration:{current:0},setPreparationIssues:v=>events.push(['issues',v]),setPreview:v=>events.push(['preview',v]),setPreviewKey:v=>events.push(['key',v]),setError:()=>{},bridge:{prepareTokenConverter:async()=>({blocked:true,issues:[issue]})},invoke:async work=>work()};
 vm.runInNewContext(fn+';this.prepareReview=prepare;',sandbox);await sandbox.prepareReview();
 assert.equal(events.some(([key,value])=>key==='issues'&&value[0]===issue),true);assert.equal(events.some(([key,value])=>key==='preview'&&value!==null),false);assert.equal(events.some(([key])=>key==='key'),false);
});
test('the compact warning routes each resolution to the affected account and respects busy state',()=>{
 const ts=require('../../casepilot/apps/web/node_modules/typescript'),path=require.resolve('../../casepilot/apps/web/src/components/ConverterPreparationIssues.jsx'),code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const sandbox={exports:{},require:name=>name==='react'?{__esModule:true,default:{createElement:(type,props,...children)=>({type,props:props||{},children})}}:name==='lucide-react'?{AlertTriangle:'icon',Settings2:'icon',UserMinus:'icon',X:'icon'}:name.includes('button')?{Button:'button'}:{t:value=>value}};vm.runInNewContext(code,sandbox);
 const events=[],props={issues:[{code:'autosell',accountId:'affected',label:'Account'}],onPreferences:id=>events.push(['preferences',id]),onExclude:id=>events.push(['exclude',id]),onRemoveOpening:()=>events.push(['remove'])};
 const buttons=disabled=>{const nodes=[];function visit(node){if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){nodes.push(node);(node.children||[]).forEach(visit);}}visit(sandbox.exports.default({...props,disabled}));return nodes.filter(node=>node.type==='button');};
 const active=buttons(false);assert.equal(active.length,3);active.forEach(button=>button.props.onClick());assert.deepEqual(events,[['preferences','affected'],['exclude','affected'],['remove']]);assert.equal(buttons(true).every(button=>button.props.disabled===true),true);
});
test('autosell preparation is planned without mutations while completing the inventory review',async t=>{
 const f=await consolidationFixture(t,{autosell:true,capsules:2});
 const preview=await f.service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open','convert-stickers']});
 assert.equal(preview.rows[0].prerequisites[0].kind,'disable-autosell');
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
