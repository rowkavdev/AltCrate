const test=require('node:test'),assert=require('node:assert/strict');
let capabilities;try{capabilities=require('../engine/extensionCapabilities.cjs');}catch{}
// If source clues accidentally enable a mutation, these guards must reject it before any transport exists.
test('boost activation stays unavailable when only UI indicators and dump endpoint strings are known',()=>{
 assert.equal(typeof capabilities?.requireExtensionCapability,'function');
 assert.throws(()=>capabilities.requireExtensionCapability('boosts','activate'),error=>error.code==='CAPABILITY_UNAVAILABLE'&&error.capabilityId==='boosts'&&error.missingEvidence.includes('activation-request-schema'));
});
test('all newly investigated opening and ticket mutations fail closed with actionable evidence gaps',()=>{
 for(const [id,action]of [['collection-opening','open'],['keychain-opening','open'],['event-ticket-opening','open'],['event-ticket-purchase','purchase']])assert.throws(()=>capabilities.requireExtensionCapability(id,action),error=>error.code==='CAPABILITY_UNAVAILABLE'&&error.missingEvidence.length>0);
});
test('capability reads are isolated and cannot promote guarded actions',()=>{
 const first=capabilities.listExtensionCapabilities(),boost=first.find(c=>c.id==='boosts');boost.state='available';boost.mutationsEnabled=true;boost.missingEvidence.length=0;
 const fresh=capabilities.getExtensionCapability('boosts');assert.equal(fresh.mutationsEnabled,false);assert.ok(fresh.missingEvidence.length);assert.throws(()=>capabilities.requireExtensionCapability('boosts','activate'),/indisponível/i);
});
test('unknown capability or action is rejected rather than forwarded',()=>{
 assert.throws(()=>capabilities.getExtensionCapability('__proto__'),/desconhecida/i);assert.throws(()=>capabilities.requireExtensionCapability('boosts','buyAnything'),/ação/i);
});
test('partial source evidence does not masquerade as successful game observation',()=>{
 const capsule=capabilities.requireExtensionCapability('capsule-opening','open');assert.equal(capsule.evidenceLevel,'local-contract-tested');assert.equal(capsule.liveVerified,false);assert.ok(capsule.missingEvidence.includes('live-general-capsule-opening'));
 const ticket=capabilities.getExtensionCapability('event-ticket-opening');assert.ok(ticket.missingEvidence.includes('ticket-stock-reconciliation-after-timeout'));assert.ok(ticket.sourceRefs.every(source=>source.url.startsWith('https://case-clicker.com/')));
});
