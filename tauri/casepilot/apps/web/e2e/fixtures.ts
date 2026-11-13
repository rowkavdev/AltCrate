import { expect, test as base } from "@playwright/test"

export type Command = { channel: string; args: unknown[] }

export const test = base.extend<{ commands: Command[] }>({
  commands: async ({ page, baseURL }, run) => {
    const commands: Command[] = []
    const pageErrors: string[] = []
    const unexpectedRequests: string[] = []
    const unexpectedCommands: string[] = []
    const origin = new URL(baseURL!).origin

    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.context().routeWebSocket(/.*/, (socket) => {
      unexpectedRequests.push(socket.url())
      void socket.close()
    })
    await page.route("**/*", (route) => {
      const url = route.request().url()
      if (new URL(url).origin === origin) return route.continue()
      unexpectedRequests.push(url)
      return route.abort()
    })
    await page.exposeFunction("recordCommand", (command: Command) => commands.push(command))
    await page.exposeFunction("unexpectedCommand", (command: string) => unexpectedCommands.push(command))
    await page.addInitScript(() => {
      const accounts = [
        { id: "alpha", label: "Alpha" },
        { id: "beta", label: "Beta" },
      ]
      const fixture = window as typeof window & {
        recordCommand: (command: Command) => Promise<void>
        unexpectedCommand: (command: string) => Promise<void>
      }
      const item = { id: "item-1", name: "Synthetic USP-S", price: 12.5, rarity: "Covert" }
      const pending = {
        operationId: "pending-operation",
        accountId: "alpha",
        item: { ...item, name: "Pending transfer item" },
        kind: "transfer",
        state: "unconfirmed",
        message: "Por confirmar",
        updatedAt: "2025-01-01T12:00:00.000Z",
      }
      const previous = {
        ...pending,
        operationId: "completed-operation",
        item: { ...item, name: "Previously sold item" },
        kind: "sell",
        state: "confirmed",
        message: "Venda confirmada",
        updatedAt: "2025-01-02T12:00:00.000Z",
      }
      const staticResponses = {
        "accounts:list": accounts,
        "accounts:login-status": { phase: "idle" },
        "accounts:refresh": { ok: true, snapshot: { observedAt: Date.now() } },
        "farm:status": { phase: "idle", accounts: [] },
        "farm:server-config": { enabled: false, profile: null },
        "open:status": { phase: "idle" },
        "converter:status": { phase: "idle", rows: [] },
        "workspace:read": { groups: [], accountGroups: {}, profiles: [] },
        "extensions:capabilities": [],
        "inventory-batch:list": [],
        "ranking:read": { rows: [] },
        "inventory-action:list": [pending, previous],
        "inventory:summary": { value: 12.5, events: [], errors: [], readAt: Date.now() },
      }
      const callbacks = new Map<number, (event: unknown) => void>()
      let callbackId = 0
      let subscriber: number | undefined

      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback(callback: (event: unknown) => void) {
            callbacks.set(++callbackId, callback)
            return callbackId
          },
          async invoke(command: string, payload: Command & { handler: number }) {
            if (command === "plugin:event|listen") {
              subscriber = payload.handler
              return subscriber
            }
            if (command !== "engine_invoke") {
              await fixture.unexpectedCommand(command)
              throw new Error("Unexpected IPC command " + command)
            }
            const { channel, args } = payload
            await fixture.recordCommand({ channel, args })
            if (Object.hasOwn(staticResponses, channel)) {
              return staticResponses[channel as keyof typeof staticResponses]
            }
            switch (channel) {
              case "preferences:read":
                return { enableSiteOpening: localStorage.getItem("fixture:opening") === "true" }
              case "preferences:update": {
                const patch = args[0] as { enableSiteOpening: boolean }
                localStorage.setItem("fixture:opening", String(patch.enableSiteOpening))
                return patch
              }
              case "inventory:read": {
                const skin = args[0] === "beta" ? { ...item, name: "Synthetic AK-47" } : item
                return { skins: [skin], pages: 1, count: 1 }
              }
              case "inventory-batch:prepare": {
                const request = args[0] as { kind: string; refs: { accountId: string; itemId: string }[] }
                return {
                  batchId: "review-batch", kind: request.kind, state: "review",
                  createdAt: new Date().toISOString(), expiresAt: Date.now() + 60_000,
                  items: request.refs.map((ref) => ({
                    ref, state: "queued", preview: { item, sourceLabel: "Alpha", steps: ["Vender por dinheiro virtual"] },
                  })),
                }
              }
              case "inventory-action:prepare":
                return {
                  previewId: "preview-1", kind: "sell", item, sourceLabel: "Alpha",
                  steps: ["Vender por dinheiro virtual"],
                }
              case "inventory-action:confirm": {
                const operation = {
                  ...previous,
                  operationId: "new-operation",
                  item,
                  updatedAt: new Date().toISOString(),
                }
                callbacks.get(subscriber!)?.({ payload: { type: "inventory-action", ...operation } })
                return { operation }
              }
              default:
                await fixture.unexpectedCommand(channel)
                throw new Error("Unexpected engine command " + channel)
            }
          },
        },
      })
    })

    await run(commands)
    expect(pageErrors, "Uncaught renderer errors").toEqual([])
    expect(unexpectedRequests, "Requests outside the local test server").toEqual([])
    expect(unexpectedCommands, "Missing offline IPC fixtures").toEqual([])
  },
})

export { expect }
