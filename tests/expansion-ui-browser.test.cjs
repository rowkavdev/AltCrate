const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),runElectron=require('./helpers/electron.cjs');
test('offline expanded UI reviews eligibility, stops pending batches and preserves configuration-only loading',{timeout:60000},async()=>{
 const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
 const result=await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[react()],logLevel:'silent',build:{write:false,lib:{entry:path.resolve('scripts/expansion-ui-harness.jsx'),name:'ProgressionUiChecks',formats:['iife']}}});
 const output=(Array.isArray(result)?result[0]:result).output,code=output.find(item=>item.type==='chunk').code,css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-expansion-ui-'));
 try{
 const html=path.join(dir,'checks.html');
 await fs.writeFile(path.join(dir,'harness.js'),code);
 await fs.writeFile(path.join(dir,'harness.css'),css);
 await fs.writeFile(html,'<!doctype html><html lang="pt"><head><meta charset="utf-8"><link rel="stylesheet" href="harness.css"></head><body><div id="root" style="padding:16px"></div><script src="harness.js"></script></body></html>');
 const env={CASEPILOT_SCREENSHOT_DIR:path.resolve('artifacts/casepilot-expansion-2026-10-14/ui')};
 const {stdout,stderr}=await runElectron([path.resolve('scripts/expansion-ui-electron.cjs'),html],{timeout:50000,env});
 assert.ok(stdout.trim(),'Electron output missing: '+stderr);const report=JSON.parse(stdout.trim().split('\n').at(-1));assert.deepEqual(report.failures,[]);assert.equal(report.layouts.length,12);assert.deepEqual(report.layouts.filter(item=>item.overflow),[]);assert.equal(report.checks.length,4);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
