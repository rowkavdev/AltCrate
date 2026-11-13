const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const web=path.resolve(__dirname,'../../casepilot/apps/web'),ts=require(web+'/node_modules/typescript');
const jsx=(type,props,...children)=>({type,props:props||{},children});
function nodes(value,out=[]){if(Array.isArray(value))value.forEach(v=>nodes(v,out));else if(value&&typeof value==='object'){out.push(value);(value.children||[]).forEach(v=>nodes(v,out));}return out;}
function text(value){return Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?(value.children||[]).map(text).join(' '):value==null||typeof value==='boolean'?'':String(value);}
async function harness(file){
 let cursor=0,slots=[],effects=[];let view={};try{view=await import(web+'/src/inventoryOperationViewModel.js');}catch{}
 const selection=await import(web+'/src/inventorySelection.js');
 const react={__esModule:true,default:{createElement:jsx,Fragment:'Fragment'},useMemo:fn=>fn(),useCallback:fn=>fn(),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn){effects.push(fn);},useLayoutEffect(fn){effects.push(fn);}};
 const source=ts.transpileModule(fs.readFileSync(web+'/src/'+file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const box={exports:{},Date,setTimeout,clearTimeout,document:{activeElement:null},require:name=>name==='react'?react:name.includes('inventoryOperationViewModel')?view:name.includes('inventorySelection')?selection:name.includes('language')?{t:v=>v,getLocale:()=> 'pt-PT'}:name.includes('format')?{formatNumber:String,formatMoney:String,formatTime:String}:name.includes('useInventoryActions')?{useInventoryActions:()=>({})}:name.endsWith('.css')?{}:name.endsWith('.jsx')?new Proxy({__esModule:true,default:name.split('/').at(-1).replace('.jsx','')},{get:(o,k)=>k in o?o[k]:String(k)}):new Proxy({},{get:(_,k)=>String(k)})};vm.runInNewContext(source,box);
 return {render(name,props){cursor=0;effects=[];return box.exports[name](props);},effects:()=>effects};
}
const op=(patch={})=>({operationId:'op',accountId:'a',kind:'convert',item:{id:'x',name:'Sample item'},state:'confirmed',verified:true,updatedAt:'2026-10-26T12:00:00Z',message:'Conversão confirmada',...patch});
test('confirmed operations start inside collapsed history and pending operations are never lost after twenty newer results',async()=>{
 const h=await harness('pages/InventoryActions.jsx'),history=Array.from({length:35},(_,i)=>op({operationId:'done-'+i,item:{name:'Completed '+i},updatedAt:'2026-10-26T13:00:00Z'})),pending=op({operationId:'pending',state:'unconfirmed',verified:false,item:{name:'Pending old item'}});
 const tree=h.render('InventoryOperations',{model:{inventoryOperations:Object.fromEntries([...history,pending].map(v=>[v.operationId,v]))},controller:{showOperation(){}},accountId:'a'});
 assert.match(text(tree),/Pending old item/);const details=nodes(tree).find(v=>v.type==='details');assert.ok(details);assert.equal(!!details.props.open,false);assert.match(text(details),/Histórico/);
});
test('history pagination makes all confirmed operations reachable without an arbitrary twenty-row cap',async()=>{
 const h=await harness('pages/InventoryActions.jsx'),records=Array.from({length:35},(_,i)=>op({operationId:'done-'+i,item:{name:'Completed '+String(i).padStart(2,'0')}})),props={model:{inventoryOperations:Object.fromEntries(records.map(v=>[v.operationId,v]))},controller:{showOperation(){}},accountId:'a'};
 let tree=h.render('InventoryOperations',props);const visited=new Set();for(let i=0;i<4;i++){for(const node of nodes(tree))if(node.type==='article')for(const match of text(node).matchAll(/Completed (\d+)/g))visited.add(match[1]);const next=nodes(tree).find(v=>v.type==='button'&&v.props['aria-label']==='Página seguinte do histórico');if(next&&!next.props.disabled){next.props.onClick();tree=h.render('InventoryOperations',props);}}
 assert.equal(visited.size,35);
});
test('a fresh direct result wins over an older operation cached in the workspace',async()=>{
 const h=await harness('useInventoryActions.js'),props={model:{inventoryOperations:{op:op({state:'unconfirmed',verified:false,updatedAt:'2026-10-26T11:00:00Z'})},accounts:[],bridge:{}},refKey:'a'};
 let controller=h.render('useInventoryActions',props);controller.showOperation(op());controller=h.render('useInventoryActions',props);assert.equal(controller.operation.state,'confirmed');
 props.model.inventoryOperations.op=op({updatedAt:'2026-10-26T14:00:00Z',message:'New observation'});controller=h.render('useInventoryActions',props);assert.equal(controller.operation.message,'New observation');
});
test('closing an operation while its request is pending keeps the controller locked until its result arrives',async()=>{
 let finish;const work=new Promise(resolve=>{finish=resolve;});const h=await harness('useInventoryActions.js'),props={model:{accounts:[],bridge:{verifyInventoryOperation:()=>work}},refKey:'a'};let controller=h.render('useInventoryActions',props);controller.showOperation(op({state:'unconfirmed',verified:false}));controller=h.render('useInventoryActions',props);const running=controller.verify();controller.closeReview();controller=h.render('useInventoryActions',props);assert.ok(controller.operation);assert.equal(controller.busy,true);finish(op());await running;controller=h.render('useInventoryActions',props);assert.equal(controller.operation.state,'confirmed');assert.equal(controller.busy,false);
});
test('result dialog blocks closing during an in-flight action',async()=>{
 let closed=0;const h=await harness('pages/InventoryActions.jsx'),props={accounts:[],controller:{operation:op(),busy:true,closeReview(){closed++;}}};const tree=h.render('default',props);tree.props.onClose();assert.equal(closed,0);const close=nodes(tree).find(v=>v.type==='button'&&text(v)==='Fechar');assert.equal(close.props.disabled,true);
});
test('real pending operations are placed before the collection in the inventory workspace',async()=>{
 const h=await harness('pages/InventoryPage.jsx'),tree=h.render('default',{model:{accounts:[{id:'a',label:'A'}],bridge:{},snapshots:{},inventoryOperations:{op:op({state:'unconfirmed',verified:false})}},ui:{accountId:'a'},onUiChange(){},onNavigate(){}}),list=nodes(tree);const operations=list.findIndex(v=>v.type==='InventoryOperations'),collection=list.findIndex(v=>v.props.className==='panel inventory-results');assert.ok(operations>=0&&operations<collection);
});
