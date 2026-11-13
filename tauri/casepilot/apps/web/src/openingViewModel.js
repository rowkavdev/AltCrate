const categories = new Set([
  "cases",
  "capsules",
  "collections",
  "keychainCollections",
])
const searchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
export function createOpeningCatalog({
  catalog = [],
  accounts = [],
  selectedIds = [],
  snapshots = {},
} = {}) {
  const known = new Set(accounts.map((account) => account.id)),
    selected = new Set(selectedIds.filter((id) => known.has(id))),
    rows = new Map()
  for (const box of catalog)
    if (box?.id)
      rows.set(box.id, {
        ...box,
        category: categories.has(box.category) ? box.category : "cases",
        stockByAccount: {},
      })
  for (const account of accounts)
    for (const box of snapshots[account.id]?.cases || []) {
      if (!box?.id || !Number.isSafeInteger(box.amount) || box.amount <= 0)
        continue
      if (!rows.has(box.id))
        rows.set(box.id, {
          id: box.id,
          name: box.name || box.id,
          image: box.image || "",
          category: "cases",
          stockByAccount: {},
        })
      const stock = rows.get(box.id).stockByAccount
      stock[account.id] = Math.max(stock[account.id] || 0, box.amount)
    }
  return [...rows.values()].map((box) => {
    const holderIds = Object.keys(box.stockByAccount),
      selectedHolderIds = holderIds.filter((id) => selected.has(id))
    return {
      ...box,
      name: box.name || box.id,
      search: searchText(box.name || box.id),
      holderIds,
      selectedHolderIds,
      total: selectedHolderIds.reduce(
        (sum, id) => sum + box.stockByAccount[id],
        0
      ),
    }
  })
}
export function selectOpeningCatalog(
  rows,
  {
    category = "all",
    stockOnly = false,
    favoritesOnly = false,
    favorites = [],
    query = "",
    sort = "quantity",
  } = {}
) {
  const wanted = searchText(query.trim()),
    saved = new Set(favorites)
  return rows
    .filter(
      (row) =>
        (category === "all" || row.category === category) &&
        (!stockOnly || row.total > 0) &&
        (!favoritesOnly || saved.has(row.id)) &&
        (!wanted || (row.search || searchText(row.name)).includes(wanted))
    )
    .sort(
      (a, b) =>
        (sort === "quantity" ? b.total - a.total : 0) ||
        a.name.localeCompare(b.name, "en", { numeric: true })
    )
}
export function openingCatalogPage(rows, options = {}) {
  const items = options.prepared ? rows : selectOpeningCatalog(rows, options),
    pageSize = [12, 24].includes(options.pageSize) ? options.pageSize : 12,
    pages = Math.max(1, Math.ceil(items.length / pageSize)),
    page = Math.min(
      pages,
      Math.max(1, Number.isSafeInteger(options.page) ? options.page : 1)
    )
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    pages,
    page,
    pageSize,
    start: items.length ? (page - 1) * pageSize + 1 : 0,
    end: Math.min(page * pageSize, items.length),
  }
}
export function openingAccountsWithoutStock(
  stockByAccount = {},
  selectedIds = [],
  snapshots = {}
) {
  return [...new Set(selectedIds)].filter((id) => {
    const snapshot = snapshots[id]
    return Array.isArray(snapshot?.cases) &&
      !snapshot.error && !snapshot.refreshError &&
      !(stockByAccount[id] > 0)
  })
}
export function openingQuantityPreview(
  stockByAccount = {},
  selectedIds = [],
  quantity = null
) {
  const count = quantity === null ? null : Number(quantity),
    valid =
      quantity === null ||
      (String(quantity).trim() !== "" &&
        Number.isSafeInteger(count) &&
        count >= 1 &&
        count <= 10000)
  if (!valid) return { valid: false, total: 0, accounts: 0 }
  let total = 0,
    accounts = 0
  for (const id of new Set(selectedIds)) {
    const stock = stockByAccount[id] || 0
    if (stock > 0) {
      accounts++
      total += count === null ? stock : Math.min(stock, count)
    }
  }
  return { valid: true, total, accounts }
}
