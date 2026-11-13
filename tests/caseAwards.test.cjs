const test = require('node:test');
const assert = require('node:assert/strict');
const groupCaseAwards = (...args) => import('../src/caseAwards.js').then((mod) => mod.groupCaseAwards(...args));
const inferCaseAward = (...args) => import('../electron/caseAward.cjs').then((mod) => mod.inferCaseAward(...args));

test('groups only accepted positive awards per account and case', async () => {
  const events = [
    { type: 'request', kind: 'case', accountId: 'a', caseId: 'x', awardedCount: 2, httpStatus: 200, at: '2026-10-08T01:00:00Z', verifiedDelta: null },
    { type: 'request', kind: 'case', accountId: 'a', caseId: 'x', caseName: 'Gallery', awardedCount: 3, httpStatus: 200, at: '2026-10-08T02:00:00Z', verifiedDelta: 3 },
    { type: 'request', kind: 'case', accountId: 'b', caseId: 'x', awardedCount: 4, httpStatus: 200, at: '2026-10-08T03:00:00Z', verifiedDelta: 4 },
    { type: 'request', kind: 'case', accountId: 'a', caseId: 'x', awardedCount: 10, httpStatus: 429 },
  ];
  assert.deepEqual((await groupCaseAwards(events, { x: 'Known' })).map((g) => [g.accountId, g.name, g.count, g.unverified]), [['b', 'Known', 4, 0], ['a', 'Gallery', 5, 1]]);
});

test('one matching inventory increase supplies the case identity when response omits it', async () => {
  const before = { cases: [{ id: 'a', name: 'Gallery Case', amount: 4 }, { id: 'b', name: 'Kilowatt Case', amount: 2 }] };
  const after = { cases: [{ id: 'a', name: 'Gallery Case', amount: 320 }, { id: 'b', name: 'Kilowatt Case', amount: 2 }] };
  assert.deepEqual(await inferCaseAward(before, after, { awardedCount: 316 }), { caseId: 'a', caseName: 'Gallery Case' });
  assert.deepEqual(await inferCaseAward(before, { cases: [{ id: 'a', name: 'Gallery Case', amount: 100 }, { id: 'b', name: 'Kilowatt Case', amount: 222 }] }, { awardedCount: 316 }), { caseId: '', caseName: '' });
});
