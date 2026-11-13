export function groupCaseAwards(events, labels = {}) {
  const groups = new Map();
  for (const event of events) {
    if (event.type !== 'request' || event.kind !== 'case' || event.httpStatus < 200 || event.httpStatus >= 300) continue;
    const count = Number(event.awardedCount);
    if (!Number.isFinite(count) || count <= 0) continue;
    const id = String(event.caseId || event.caseName || 'unknown');
    const key = `${event.accountId}:${id}`;
    const group = groups.get(key) || { accountId: event.accountId, caseId: id, name: event.caseName || labels[id] || 'Caixas sem tipo identificado', count: 0, lastAt: '', requests: 0, unverified: 0 };
    group.count += count;
    group.requests++;
    if (!group.lastAt || event.at > group.lastAt) group.lastAt = event.at;
    if (event.verifiedDelta === null) group.unverified++;
    if (event.caseName) group.name = event.caseName;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

