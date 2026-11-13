import { useEffect, useRef, useState } from "react"
export function useCaseCatalog({
  bridge,
  accountCount,
  paused = false,
  refreshToken = 0,
}) {
  const [state, setState] = useState({
    catalog: [],
    loading: true,
    refreshing: false,
    error: "",
    discovery: null,
  })
  const manual = useRef(refreshToken)
  useEffect(() => {
    let live = true,
      timer,
      inFlight = false,
      nextAt = 0
    const enabled = () =>
      !!accountCount &&
      !paused &&
      document.visibilityState === "visible" &&
      navigator.onLine !== false
    const force = manual.current !== refreshToken
    manual.current = refreshToken
    if (!bridge?.listCaseShowcase || !accountCount) {
      setState((current) => ({ ...current, loading: false }))
      return
    }
    function schedule() {
      clearTimeout(timer)
      if (live && enabled())
        timer = setTimeout(
          () => run(false),
          Math.max(1000, nextAt - Date.now())
        )
    }
    async function run(forced) {
      if (!live || !enabled() || inFlight) return
      if (!forced && nextAt > Date.now()) {
        schedule()
        return
      }
      inFlight = true
      setState((current) => ({
        ...current,
        loading: !current.catalog.length,
        refreshing: true,
      }))
      try {
        const value = bridge.discoverCaseCatalog
          ? await bridge.discoverCaseCatalog({ force: forced })
          : {
              catalog: await bridge.listCaseShowcase(),
              event: null,
              nextRefreshAt: Date.now() + 300000,
            }
        if (!Array.isArray(value?.catalog))
          throw Error("Catálogo publicado inválido")
        nextAt = Math.max(
          Date.now() + 1000,
          Number(value.nextRefreshAt) || Date.now() + 300000
        )
        if (live)
          setState({
            catalog: value.catalog,
            loading: false,
            refreshing: false,
            error: value.stale ? value.error || "Catálogo por atualizar" : "",
            discovery: value,
          })
      } catch (error) {
        nextAt = Date.now() + 300000
        if (live)
          setState((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            error: error.message,
          }))
      } finally {
        inFlight = false
        schedule()
      }
    }
    const changed = () => {
      clearTimeout(timer)
      if (enabled()) run(false)
    }
    run(force)
    document.addEventListener("visibilitychange", changed)
    window.addEventListener("online", changed)
    window.addEventListener("offline", changed)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", changed)
      window.removeEventListener("online", changed)
      window.removeEventListener("offline", changed)
    }
  }, [bridge, accountCount, paused, refreshToken])
  return state
}
