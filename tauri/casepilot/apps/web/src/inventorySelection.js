export const INVENTORY_SELECTION_LIMIT = 200

export function selectInventoryPage(selection, items, accountId, page) {
  const next = [...selection]
  const keys = new Set(next.map((entry) => entry.key))
  for (const item of items) {
    const key = accountId + ":" + item.id
    if (keys.has(key)) continue
    if (next.length >= INVENTORY_SELECTION_LIMIT) break
    keys.add(key)
    next.push({
      key,
      item,
      ref: {
        accountId,
        itemId: item.id,
        storageUnitId: null,
        page,
        name: item.name,
      },
    })
  }
  return next
}

export function deselectInventoryPage(selection, items, accountId) {
  const keys = new Set(items.map((item) => accountId + ":" + item.id))
  return selection.filter((entry) => !keys.has(entry.key))
}

export function inventorySelectionTotals(selection) {
  let value = 0,
    unknownPrices = 0
  const accounts = new Set()
  for (const entry of selection) {
    accounts.add(entry.ref.accountId)
    if (
      typeof entry.item.price === "number" &&
      Number.isFinite(entry.item.price)
    )
      value += entry.item.price
    else unknownPrices++
  }
  return {
    count: selection.length,
    value,
    unknownPrices,
    accounts: accounts.size,
  }
}
