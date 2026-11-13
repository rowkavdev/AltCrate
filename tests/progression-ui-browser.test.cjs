const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('offline Electron progression flow guards switching, confirmation, stop and retries',{timeout:60000},async()=>{
 const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
 const result=await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[react()],logLevel:'silent',build:{write:false,lib:{entry:path.resolve('scripts/progression-ui-harness.jsx'),name:'ProgressionUiChecks',formats:['iife']}}});
 const output=(Array.isArray(result)?result[0]:result).output,code=output.find(item=>item.type==='chunk').code,css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-progression-ui-'));
 try{const html=path.join(dir,'checks.html');await fs.writeFile(html,`<!doctype html><html lang="pt"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root" style="padding:16px"></div><script>${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.resolve('scripts/progression-ui-electron.cjs'),html],{env,timeout:50000,maxBuffer:200000});
 assert.ok(stdout.trim(),'Electron output missing: '+stderr);const report=JSON.parse(stdout.trim().split('\n').at(-1));assert.deepEqual(report.failures,[]);assert.equal(report.layouts.length,16);assert.deepEqual(report.layouts.filter(item=>item.overflow),[]);assert.ok(report.checks.includes('confirmation can be stopped while awaiting response'));assert.ok(report.checks.includes('late account read ignored'));assert.ok(report.checks.includes('failed read can be retried'));assert.ok(report.checks.includes('dialog traps focus and Escape closes review'));assert.ok(report.checks.includes('claim all sends every reward type once and refreshes the account'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
