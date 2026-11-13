const test=require('node:test');
const assert=require('node:assert/strict');
test('hash routes accept current pages and normalize old or unknown anchors',async()=>{
  const {PAGE_DEFINITIONS,parsePageHash,pageHash}=await import('../src/workspaceNavigation.js');
  assert.equal(parsePageHash('#opening'),'opening');
  assert.equal(parsePageHash('#inventory'),'inventory');
  assert.equal(parsePageHash('#awards'),'overview');
  assert.equal(parsePageHash('#missing'),'overview');
  assert.equal(PAGE_DEFINITIONS.length,13);
  for(const {id} of PAGE_DEFINITIONS)assert.equal(parsePageHash(pageHash(id)),id);
});
