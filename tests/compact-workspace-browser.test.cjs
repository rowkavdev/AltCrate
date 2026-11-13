const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),runElectron=require('./helpers/electron.cjs');
test('compact workspace exposes tasks, shared selection, keyboard tabs and active stop controls',{timeout:60000},async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-compact-build-'));
 try{
  const {build}=await import('vite');await build({build:{outDir:directory,emptyOutDir:true},logLevel:'error'});

  const {stdout}=await runElectron([path.resolve('scripts/check-compact-workspace.cjs'),path.join(directory,'index.html')],{timeout:50000});
  const report=JSON.parse(stdout.trim().split('\n').at(-1));assert.ok(report.checks.length>=14);assert.deepEqual(report.checks.filter(check=>!check.passed),[]);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
