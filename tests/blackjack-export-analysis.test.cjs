const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('analysis does not call an unbet pending round a progression error',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackjack-analysis-'));
 try {
  const file=path.join(dir,'source.json'),csv=path.join(dir,'reference.csv'),out=path.join(dir,'report.json');
  const common={accountId:'a',tableId:'t',shuffleCount:1,dealerCards:[],hands:[],turnsWithoutCommand:0};
  fs.writeFileSync(file,JSON.stringify({exportedAt:'2026-10-09T09:00:00Z',events:[],blackjack:[{...common,roundNumber:1,phase:'result',startedAt:'2026-10-09T08:00:00Z',netProfit:10,actions:[{action:'bet',bet:10,tokens:100}]},{...common,roundNumber:2,phase:'betting',startedAt:'2026-10-09T08:00:30Z',netProfit:null,actions:[]}]}));
  fs.writeFileSync(csv,'n17,s,s,s,s,s,s,s,s,s,s\n');
  const run=spawnSync(process.execPath,[path.resolve('scripts/analyze-blackjack-export.mjs'),file,csv,out],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.deepEqual(report.summary.progressionErrors,[]);assert.equal(report.rows[1].progressionMatches,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
