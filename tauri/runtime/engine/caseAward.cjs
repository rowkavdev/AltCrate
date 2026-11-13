function inferCaseAward(before, after, result = {}) {
  const cases = Array.isArray(after?.cases) ? after.cases : [];
  const suppliedId = typeof result.caseId === 'string' ? result.caseId : '';
  const suppliedName = typeof result.caseName === 'string' ? result.caseName : '';
  if (suppliedId || suppliedName) {
    const match = cases.find((item) => item.id === suppliedId);
    return { caseId: suppliedId, caseName: suppliedName || String(match?.name || '') };
  }
  const awarded = Number(result.awardedCount);
  if (!Array.isArray(before?.cases) || !Number.isFinite(awarded) || awarded <= 0) return { caseId: '', caseName: '' };
  const previous = new Map(before.cases.map((item) => [item.id, Number(item.amount)]));
  const increases = cases.filter((item) => Number(item.amount) - (previous.get(item.id) || 0) > 0);
  if (increases.length !== 1) return { caseId: '', caseName: '' };
  const item = increases[0];
  if (Number(item.amount) - (previous.get(item.id) || 0) !== awarded) return { caseId: '', caseName: '' };
  return { caseId: String(item.id || ''), caseName: String(item.name || '') };
}

module.exports = { inferCaseAward };
