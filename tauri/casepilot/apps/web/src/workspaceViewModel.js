// Index collections once per change, instead of searching them inside render loops.
export function accountIndex(accounts = []) {
  return new Map(accounts.map((account) => [account.id, account]));
}

export function selectedCaseTotals(selectedIds = [], snapshots = {}) {
  const totals = new Map();
  for (const id of selectedIds) {
    for (const box of snapshots[id]?.cases || []) {
      totals.set(box.id, (totals.get(box.id) || 0) + (box.amount || 0));
    }
  }
  return totals;
}

export function commonCaseChoices(selectedIds = [], snapshots = {}) {
  if (!selectedIds.length) return [];
  const first = snapshots[selectedIds[0]]?.cases || [];
  const stockCounts = new Map();
  for (const id of selectedIds) {
    const stocked = new Set(
      (snapshots[id]?.cases || [])
        .filter((box) => box.amount > 0)
        .map((box) => box.id),
    );
    for (const caseId of stocked)
      stockCounts.set(caseId, (stockCounts.get(caseId) || 0) + 1);
  }
  return first
    .filter(
      (box) => box.amount > 0 && stockCounts.get(box.id) === selectedIds.length,
    )
    .sort((a, b) => b.amount - a.amount);
}
