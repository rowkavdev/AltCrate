import { expect, test } from "./fixtures.ts"

test("opens the current workspace and navigates using the browser history", async ({ page, commands }) => {
  await page.goto("/#unknown")
  await expect(page).toHaveURL(/#overview$/)
  await expect(page).toHaveTitle("AltCrate")
  await expect(page.getByText("AltCrate", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible()
  await page.getByRole("link", { name: "Contas", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Contas", level: 1 })).toBeFocused()
  await expect(page.getByText("Alpha", { exact: true }).first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible()
  expect(commands).toContainEqual({ channel: "accounts:list", args: [] })
})

test("the optional route is gated and settings persist across reloads", async ({ page, commands }) => {
  await page.goto("/#autoopen")
  await expect(page).toHaveURL(/#settings$/)
  const optionalPage = page.getByRole("link", { name: "Preferências de abertura", exact: true })
  await expect(optionalPage).toHaveCount(0)
  const toggle = page.getByRole("checkbox", { name: /Mostrar preferências de abertura/ })
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(optionalPage).toBeVisible()
  expect(commands).toContainEqual({
    channel: "preferences:update",
    args: [{ enableSiteOpening: true }],
  })
  await page.reload()
  await expect(toggle).toBeChecked()
  await expect(optionalPage).toBeVisible()
})

test("inventory switches accounts and keeps pending operations ahead of history", async ({ page, commands }) => {
  await page.goto("/#inventory")
  await expect(page.getByRole("button", { name: "Ver detalhes de Synthetic USP-S" })).toBeVisible()
  const pending = page.getByText("Pending transfer item", { exact: true })
  const history = page.getByText("Previously sold item", { exact: true })
  await expect(pending).toBeVisible()
  await expect(history).toBeHidden()
  await page.getByText("Histórico (1)", { exact: true }).click()
  await expect(history).toBeVisible()
  await page.getByRole("combobox", { name: "Conta do inventário" }).selectOption("beta")
  await expect(page.getByRole("button", { name: "Ver detalhes de Synthetic AK-47" })).toBeVisible()
  await expect(pending).toHaveCount(0)
  expect(commands.some(({ channel, args }) => channel === "inventory:read" && args[0] === "beta")).toBe(true)
})

test("selling an item requires an explicit confirmation and renders the IPC result", async ({ page, commands }) => {
  await page.goto("/#inventory")
  await page.getByRole("button", { name: "Ações de Synthetic USP-S" }).click()
  await page.getByRole("menuitem", { name: "Vender por dinheiro virtual" }).click()
  const review = page.getByRole("dialog", { name: "Vender por dinheiro virtual" })
  await expect(review).toBeVisible()
  await expect(review.getByRole("heading", { name: "Synthetic USP-S" })).toBeVisible()
  expect(commands.filter(({ channel }) => channel === "inventory-action:prepare")).toMatchObject([
    { args: [{ kind: "sell", ref: { accountId: "alpha", itemId: "item-1" } }] },
  ])
  expect(commands.some(({ channel }) => channel === "inventory-action:confirm")).toBe(false)
  await review.getByRole("button", { name: "Confirmar venda" }).click()
  await expect(page.getByRole("dialog", { name: "Resultado da operação" })).toContainText("Venda confirmada")
  expect(commands.filter(({ channel }) => channel === "inventory-action:confirm")).toEqual([
    { channel: "inventory-action:confirm", args: ["preview-1"] },
  ])
})

test("an inventory batch expires while the review is open", async ({ page, commands }) => {
  await page.clock.install({ time: new Date("2025-06-01T10:00:00Z") })
  await page.goto("/#inventory")
  await page.getByRole("checkbox", { name: "Selecionar skin Synthetic USP-S" }).check()
  await page.getByRole("button", { name: "Rever ações" }).click()
  const batch = page.locator("#inventory-batch-workspace")
  await batch.getByRole("combobox", { name: "Ação", exact: true }).selectOption("sell")
  await batch.getByRole("button", { name: "Rever lote", exact: true }).click()
  const execute = batch.getByRole("button", { name: "Executar lote" })
  await expect(execute).toBeEnabled()
  expect(commands).toContainEqual(expect.objectContaining({ channel: "inventory-batch:prepare" }))
  await page.clock.fastForward(61_000)
  await expect(execute).toBeDisabled()
  await expect(batch.getByText(/A revisão expirou/)).toBeVisible()
  expect(commands.some(({ channel }) => channel === "inventory-batch:start")).toBe(false)
})

test("mobile navigation supports Escape and returns focus to its opener", async ({ page, commands }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible()
  const menu = page.getByRole("button", { name: /menu/i }).first()
  await menu.click()
  await expect(page.getByRole("link", { name: "Contas", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeFocused()
  await expect(page.getByRole("link", { name: "Contas", exact: true })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(commands).toContainEqual({ channel: "accounts:list", args: [] })
})
