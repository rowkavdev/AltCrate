// Local-only visual preview: the bridge is simulated and never uses real sessions.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('dist'),port=5191;
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/casepilot-preload.cjs'),'utf8').replace("const {contextBridge,ipcRenderer}=require('electron');",`const process={argv:['--cp-count=8','--cp-state=idle']};const ipcRenderer={send(){}};const contextBridge={exposeInMainWorld(name,value){window[name]=value;}};`);
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+port);if(url.pathname==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end('(function(){'+fixture+'})();');return;}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{let data=fs.readFileSync(file);if(file.endsWith('index.html'))data=data.toString().replace('<head>','<head><script src="/fixture.js"></script>');res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.setHeader('cache-control','no-store');res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('AltCrate design preview: http://127.0.0.1:'+port+' · simulated accounts'));
