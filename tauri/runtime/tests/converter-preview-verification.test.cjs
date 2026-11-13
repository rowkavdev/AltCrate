const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('preview verification emits running and finished outcomes rather than silently returning the previous row',async()=>{
 const window={addEventListener(){}},events=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../casepilot/apps/web/src/previewFixture.js'),'utf8'),{window,location:{search:'?converter-history=1&accounts=4'},URLSearchParams,setTimeout,clearTimeout,Headers,Response,crypto:require('node:crypto').webcrypto});
 const bridge=window.caseClicker;bridge.onEvent(event=>events.push(event));
 const checking=bridge.verifyTokenConversion('pending-fixture');
 assert.equal((await bridge.getTokenConverterStatus()).rows[0].verification?.phase,'running');
 const result=await checking,v=result.rows[0].verification;
 assert.equal(v.phase,'complete');assert.equal(v.outcome,'pending');assert.equal(v.expected,9);assert.equal(v.found,0);assert.ok(Date.parse(v.finishedAt));
 assert.equal(events[0].status.rows[0].verification.phase,'running');assert.equal(events.at(-1).status.rows[0].verification.phase,'complete');assert.equal(result.rows[0].unconfirmedResults,9);
});
