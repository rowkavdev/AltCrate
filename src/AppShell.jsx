import { t } from "./language.js";
import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  Gauge,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  Users,
  X,
  Coins,
  ChevronRight,
  Package,
  RefreshCw,
  ArrowRightLeft,
  Gift,
  Map,
  Settings2,
  ScanLine,
  Sun,
  Moon,
} from "lucide-react";
import Brand from "./Brand.jsx";
import { Button } from "./components/ui/button.jsx";
import { readTheme, saveTheme } from "./theme.js";
import {
  PAGE_DEFINITIONS,
  pageHash,
  visiblePages,
} from "./workspaceNavigation.js";
import { version } from "../package.json";

const icons = {
  settings: Settings2,
  rewards: Gift,
  skills: Map,
  autoopen: Settings2,
  diagnostics: ScanLine,
  overview: LayoutDashboard,
  accounts: Users,
  automation: Gauge,
  opening: Boxes,
  converter: ArrowRightLeft,
  inventory: Package,
  games: Coins,
  activity: Activity,
};
export default function AppShell({
  page,
  onNavigate,
  farmStatus,
  converterStatus,
  gamesAutoActive,
  notice,
  onDismissNotice,
  children,
  preferences,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    saveTheme(next);
    setTheme(next);
  };
  const menuRef = useRef(null),
    triggerRef = useRef(null);
  const headingRef = useRef(null),
    previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const media = window.matchMedia("(min-width:800px)");
    const close = () => {
      if (media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  const current =
    PAGE_DEFINITIONS.find((item) => item.id === page) || PAGE_DEFINITIONS[0];
  const converterRunning = ["preparing", "running", "stopping"].includes(
    converterStatus?.phase,
  );
  const running =
    ["running", "stopping"].includes(farmStatus?.phase) || converterRunning;
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.activeElement;
    const controls = () =>
      Array.from(
        menuRef.current?.querySelectorAll("a[href],button:not([disabled])") ||
          [],
      );
    controls()[0]?.focus();
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      (triggerRef.current || previous)?.focus();
    };
  }, [menuOpen]);
  return (
    <div className="cp-shell">
      <a
        className="skip-navigation"
        href="#workspace-heading"
        onClick={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
      >
        {t("Saltar para o conteúdo")}
      </a>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label={t("Fechar menu")}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={"sidebar" + (menuOpen ? " is-open" : "")}
        ref={menuRef}
        aria-label={t("Menu principal")}
      >
        <div className="brand-row">
          <Brand />
          <button
            className="icon-button menu-close"
            aria-label={t("Fechar menu")}
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {[
            ["Workspace", ["overview", "accounts"]],
            [
              "Operações",
              ["automation", "opening", "converter", "inventory", "games"],
            ],
            ["Progressão", ["rewards", "skills", "autoopen"]],
            ["Acompanhamento", ["activity", "diagnostics", "settings"]],
          ].map(([label, ids]) => (
            <React.Fragment key={label}>
              <div className="nav-label">{t(label)}</div>
              {visiblePages(preferences)
                .filter((item) => ids.includes(item.id))
                .map((item) => {
                  const Icon = icons[item.id];
                  return (
                    <a
                      key={item.id}
                      href={pageHash(item.id)}
                      className={page === item.id ? "active" : ""}
                      aria-current={page === item.id ? "page" : undefined}
                      title={t(item.title)}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey)
                          return;
                        event.preventDefault();
                        onNavigate(item.id);
                        setMenuOpen(false);
                      }}
                    >
                      <Icon size={18} />
                      <span>{t(item.title)}</span>
                      {page === item.id && (
                        <ChevronRight size={14} className="nav-indicator" />
                      )}
                    </a>
                  );
                })}
            </React.Fragment>
          ))}
        </nav>
        {gamesAutoActive && (
          <p className="nav-hint">
            {t("Sair de Jogos termina o automático de Blackjack.")}
          </p>
        )}
        <div className="sidebar-bottom">
          <div className="connection-note">
            <ShieldCheck size={16} />
            <span>{t("Sessões isoladas")}</span>
          </div>
          <small>
            {t("Case Clicker · v")}
            {t(version)}
          </small>
        </div>
      </aside>
      <main className="workspace" inert={menuOpen ? true : undefined}>
        <header className="topbar">
          <div>
            <button
              ref={triggerRef}
              className="icon-button menu-trigger"
              aria-label={t("Abrir menu")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span className="topbar-context">{t("CasePilot")}</span>
            <ChevronRight size={14} />
            <strong>{t(current.title)}</strong>
          </div>
          <span className={"execution-pill" + (running ? " running" : "")}>
            <span className="status-dot" />
            {t(
              converterRunning
                ? "Conversor em execução"
                : running
                  ? "Automação em execução"
                  : "Operações prontas",
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="theme-toggle"
            aria-label={t(
              theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro",
            )}
            title={t(
              theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro",
            )}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </header>
        <div className="page-body">
          <header className="page-heading">
            <div>
              <h1 id="workspace-heading" ref={headingRef} tabIndex={-1}>
                {t(current.title)}
              </h1>
              <p>{t(current.description)}</p>
            </div>
            {page === "overview" && (
              <Button
                type="button"
                variant="outline"
                className="home-refresh"
                title={t("Atualizar a página (F5)")}
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {t("Atualizar")}
              </Button>
            )}
          </header>
          {notice && (
            <div className="notice" role="status">
              <span>{t(notice)}</span>
              <button
                className="icon-button"
                onClick={onDismissNotice}
                aria-label={t("Fechar aviso")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {t(children)}
          <footer>
            <span>{t("CasePilot · Centro de operações")}</span>
            <span>{t("Saldo e tokens virtuais")}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
