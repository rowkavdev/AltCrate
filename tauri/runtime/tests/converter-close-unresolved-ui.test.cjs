const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('closing an unresolved result validates the window and operation before dispatch',async()=>{
 const {registerTokenConverterIpc}=require('../engine/tokenConverterIpc.cjs'),handlers=new Map(),closed=[];
 registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:{closeUnresolved:async id=>closed.push(id)},validateSender:event=>{if(event.sender!=='main')throw Error('Invalid sender');}});
 await assert.rejects(async()=>handlers.get('converter:close-unresolved')({sender:'other'},'op'),/sender/);
 for(const id of ['',null,3,'x'.repeat(101)])await assert.rejects(async()=>handlers.get('converter:close-unresolved')({sender:'main'},id));
 assert.deepEqual(closed,[]);await handlers.get('converter:close-unresolved')({sender:'main'},'op');assert.deepEqual(closed,['op']);
});
test('the closing dialog requires an explicit final click and targets only its own operation',async()=>{
 const ts=require('../../casepilot/apps/web/node_modules/typescript'),source=fs.readFileSync(require.resolve('../../casepilot/apps/web/src/pages/TokenConverterPage.jsx'),'utf8'),part=source.slice(source.indexOf('function Recovery('),source.indexOf('function RowDetails(')),slots=[];let cursor=0;
 const code=ts.transpileModule(part+'\nthis.Recovery=Recovery;',{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText,closed=[];
 const sandbox={React:{createElement:(type,props,...children)=>({type,props:props||{},children})},useState:initial=>{const slot=cursor++;if(!(slot in slots))slots[slot]=initial;return [slots[slot],value=>{slots[slot]=value;}];},Button:'button',Archive:'icon',Square:'icon',ArrowRight:'icon',RefreshCw:'icon',ExternalLink:'icon',Dialog:'dialog',DialogContent:'dialog-content',DialogHeader:'dialog-header',DialogTitle:'dialog-title',DialogDescription:'dialog-description',DialogFooter:'dialog-footer',formatNumber:String,t:value=>value};vm.runInNewContext(code,sandbox);
 const row={operationId:'old-opening',state:'unconfirmed',canCloseUnresolved:true,canVerify:true,unconfirmedResults:9},props={row,bridge:{closeUnresolvedTokenConversion:async id=>{closed.push(id);return {rows:[]};}},invoke:async work=>work()};
 function render(){cursor=0;const nodes=[];function visit(node){if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){nodes.push(node);(node.children||[]).forEach(visit);}}visit(sandbox.Recovery(props));return nodes;}
 const named=(nodes,label)=>nodes.filter(node=>node.type==='button'&&node.children.includes(label));
 let nodes=render();assert.deepEqual(closed,[]);named(nodes,'Encerrar sem confirmar')[0].props.onClick();nodes=render();assert.equal(nodes.find(node=>node.type==='dialog').props.open,true);assert.deepEqual(closed,[]);
 named(nodes,'Cancelar')[0].props.onClick();assert.equal(render().find(node=>node.type==='dialog').props.open,false);assert.deepEqual(closed,[]);
 named(render(),'Encerrar sem confirmar')[0].props.onClick();nodes=render();await named(nodes,'Encerrar sem confirmar').at(-1).props.onClick();assert.deepEqual(closed,['old-opening']);assert.equal(render().find(node=>node.type==='dialog').props.open,false);
});
test('demo closure keeps unknown results separate from a fresh run and never marks them confirmed',async()=>{
 const window={addEventListener(){}},events=[];
 vm.runInNewContext(fs.readFileSync(require.resolve('../../casepilot/apps/web/src/previewFixture.js'),'utf8'),{window,location:{search:'?converter-history=1&accounts=4'},URLSearchParams,setTimeout,clearTimeout,Headers,Response,crypto:require('node:crypto').webcrypto});
 const bridge=window.caseClicker;bridge.onEvent(event=>events.push(event));await bridge.verifyTokenConversion('pending-fixture');
 assert.equal(typeof bridge.closeUnresolvedTokenConversion,'function');await bridge.closeUnresolvedTokenConversion('pending-fixture');
 const preview=await bridge.prepareTokenConverter({action:'sequence',independent:true,accountIds:['a2'],steps:['sell']});await bridge.startTokenConverter({action:'sequence',previewId:preview.previewId});await new Promise(resolve=>setTimeout(resolve,120));
 const result=await bridge.getTokenConverterStatus(),old=result.rows.find(row=>row.operationId==='pending-fixture');assert.equal(old.state,'unresolved');assert.equal(old.verified,false);assert.equal(old.unconfirmedResults,9);assert.equal(old.verification.outcome,'pending');assert.ok(result.rows.some(row=>row.operationId!=='pending-fixture'&&row.accountId==='a2'));
});
test('completed missing-item feedback states the finding and distinguishes a closed record',()=>{
 const ts=require('../../casepilot/apps/web/node_modules/typescript'),code=ts.transpileModule(fs.readFileSync(require.resolve('../../casepilot/apps/web/src/components/ConverterVerificationFeedback.jsx'),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const sandbox={exports:{},require:name=>name==='react'?{__esModule:true,default:{createElement:(type,props,...children)=>({type,props:props||{},children})}}:name==='lucide-react'?{CircleAlert:'icon',CircleCheck:'icon',LoaderCircle:'icon'}:name.includes('format')?{formatNumber:String,formatTime:()=>''}:{t:value=>value}};vm.runInNewContext(code,sandbox);
 const verification={phase:'complete',outcome:'pending',errorStatus:0,expected:9,found:0};
 function words(closed){const out=[];function visit(node){if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object')(node.children||[]).forEach(visit);else if(typeof node==='string')out.push(node);}visit(sandbox.exports.default({verification,closed}));return out.join(' ');}
 assert.match(words(false),/Stickers em falta/);assert.match(words(true),/Encerrada sem confirmação/);assert.doesNotMatch(words(true),/Resultado confirmado/);
});
