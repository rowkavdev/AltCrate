import React, { lazy, Suspense, useEffect, useState } from "react";
import AppShell from "./AppShell.jsx";
import { useFarmServer } from "./useFarmServer.js";
import { useLanguage } from "./useLanguage.js";
import { useAppPreferences } from "./useAppPreferences.js";
import { useWorkspaceModel } from "./useWorkspaceModel.js";
import {
  parsePageHash,
  pageHash,
  availablePage,
} from "./workspaceNavigation.js";
import { t } from "./language.js";
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const OverviewPage = lazy(() => import("./pages/OverviewPage.jsx"));
const ActivityPage = lazy(() => import("./pages/ActivityPage.jsx"));
const AccountsPage = lazy(() => import("./pages/AccountsPage.jsx"));
const AutomationPage = lazy(() => import("./pages/AutomationPage.jsx"));
const OpeningPage = lazy(() => import("./pages/OpeningPage.jsx"));
const InventoryPage = lazy(() => import("./pages/InventoryPage.jsx"));
const TokenConverterPage = lazy(() => import("./pages/TokenConverterPage.jsx"));
const GamesMosaic = lazy(() => import("./GamesMosaic.jsx"));
const RewardsPage = lazy(() => import("./pages/RewardsPage.jsx"));
const SkillMapsPage = lazy(() => import("./pages/SkillMapsPage.jsx"));
const SiteAutoOpenPage = lazy(() => import("./pages/SiteAutoOpenPage.jsx"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage.jsx"));

const initialUi = {
  rewards: { accountId: "", tab: "rewards" },
  skills: { accountId: "", mapName: "Dust II" },
  autoopen: { accountId: "" },
  diagnostics: { accountId: "" },
  converter: { destinationAccountId: "" },
  inventory: {
    accountId: "",
    query: "",
    search: "",
    favorites: "all",
    sort: "true",
    page: 1,
    detailId: null,
    dataKey: "",
    data: null,
    readAt: 0,
  },
  accounts: { query: "", status: "all", detailId: null },
  automation: {
    query: "",
    filter: "all",
    scrollTop: 0,
    detailId: null,
    bulkModes: { case: true, money: true, vault: true },
  },
  activity: { query: "", accountId: "all", operation: "all", result: "all" },
  games: {
    columns: 3,
    batchAmount: "10",
    aiMode: "math",
    progression: "edge",
    sections: {},
    cards: {},
  },
};
export default function App() {
  useLanguage();
  const model = useWorkspaceModel(
    typeof window !== "undefined" ? window.caseClicker : null,
  );
  const preferencesController = useAppPreferences(model.bridge);
  const serverController = useFarmServer(
    model.bridge,
    (model.farmStatus?.execution?.kind || "local") +
      "|" +
      (model.farmStatus?.execution?.transition || ""),
  );
  const { preferences } = preferencesController;
  const [page, setPage] = useState(() =>
    parsePageHash(typeof window !== "undefined" ? window.location.hash : ""),
  );
  const [pageUi, setPageUiState] = useState(initialUi);
  const [gamesAutoActive, setGamesAutoActive] = useState(false);
  function setPageUi(id, patch) {
    setPageUiState((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        ...(typeof patch === "function" ? patch(previous[id]) : patch),
      },
    }));
  }
  function navigate(id) {
    window.location.hash = pageHash(availablePage(id, preferences));
  }
  useEffect(() => {
    const update = () => {
      const parsed = parsePageHash(window.location.hash),
        next = preferencesController.loading
          ? parsed
          : availablePage(parsed, preferences);
      setPage(next);
      if (window.location.hash !== pageHash(next))
        window.history.replaceState(null, "", pageHash(next));
    };
    window.addEventListener("hashchange", update);
    update();
    return () => window.removeEventListener("hashchange", update);
  }, [preferences.enableSiteOpening, preferencesController.loading]);
  useEffect(() => {
    if (page !== "games") setGamesAutoActive(false);
  }, [page]);
  const activePage = availablePage(page, preferences);
  const pages = {
    overview: OverviewPage,
    accounts: AccountsPage,
    automation: AutomationPage,
    opening: OpeningPage,
    converter: TokenConverterPage,
    inventory: InventoryPage,
    rewards: RewardsPage,
    skills: SkillMapsPage,
    autoopen: SiteAutoOpenPage,
    diagnostics: DiagnosticsPage,
    activity: ActivityPage,
  };
  const Page = pages[activePage];
  const content =
    activePage === "settings" ? (
      <SettingsPage
        preferencesController={preferencesController}
        capabilities={model.extensionCapabilities}
        serverController={serverController}
      />
    ) : activePage === "games" ? (
      <GamesMosaic
        accounts={model.accounts}
        onBack={() => navigate("overview")}
        bettingIds={model.bettingIds}
        setBettingIds={model.setBettingIds}
        stats={model.blackjackStats}
        setStats={model.setBlackjackStats}
        ui={pageUi.games}
        onUiChange={(patch) => setPageUi("games", patch)}
        onAutoStateChange={setGamesAutoActive}
      />
    ) : (
      <Page
        model={model}
        ui={pageUi[activePage]}
        onUiChange={(patch) => setPageUi(activePage, patch)}
        onNavigate={navigate}
      />
    );
  return (
    <AppShell
      preferences={preferences}
      page={activePage}
      onNavigate={navigate}
      farmStatus={model.farmStatus}
      converterStatus={model.converter}
      gamesAutoActive={gamesAutoActive}
      notice={model.notice}
      onDismissNotice={() => model.setNotice("")}
    >
      <Suspense
        fallback={
          <section className="panel page-loading" role="status">
            {t("A carregar…")}
          </section>
        }
      >
        {content}
      </Suspense>
    </AppShell>
  );
}
