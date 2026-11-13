import { accountIndex } from "../workspaceViewModel.js";
import { t } from "../language.js";
import React, { useMemo } from "react";
import { Users, Boxes, Wallet, Coins, Zap, ArrowUpRight } from "lucide-react";
import { farmAccountActivity } from "../farmViewModel.js";
import { formatMoney, formatNumber, formatTime } from "../format.js";
import EventRow from "../components/EventRow.jsx";
import { Card } from "../components/ui/card.jsx";
import { Button } from "../components/ui/button.jsx";
import OperationSummary from "../components/OperationSummary.jsx";
export default function OverviewPage({ model, onNavigate }) {
  const { accounts, snapshots, totals, farmStatus, events, awards, loading } =
    model;
  const accountsById = useMemo(() => accountIndex(accounts), [accounts]);
  const metrics = [
    [
      "Contas ligadas",
      formatNumber(totals.connected),
      accounts.length +
        " " +
        (accounts.length === 1 ? "registada" : "registadas"),
      Users,
    ],
    [
      "Caixas nas contas",
      formatNumber(totals.cases),
      "Último estado observado",
      Boxes,
    ],
    [
      "Saldo virtual",
      formatMoney(totals.money),
      "Soma das contas ligadas",
      Wallet,
    ],
    [
      "Tokens nas contas",
      formatNumber(totals.tokens, 2),
      "Soma das contas ligadas",
      Coins,
    ],
    [
      "Contas a farmar",
      formatNumber(
        (farmStatus.accounts || []).filter(
          (item) => farmAccountActivity(item, farmStatus).active,
        ).length,
      ),
      "Espera indicada abaixo",
      Zap,
    ],
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map(([label, value, note, Icon]) => (
          <Card className="metric" key={label}>
            <div className="metric-label">
              <Icon size={16} />
              {t(label)}
            </div>
            <strong>{t(loading ? "—" : value)}</strong>
            <small>{t(note)}</small>
          </Card>
        ))}
      </div>
      <div className="overview-shortcuts">
        {[
          ["automation", "Automação", "Caixas, dinheiro e cofre", Boxes],
          [
            "opening",
            "Abrir caixas",
            "Escolher a caixa e rever as regras",
            Zap,
          ],
          ["inventory", "Inventário", "Consultar e gerir os itens", Coins],
        ].map(([id, title, description, Icon]) => (
          <button type="button" key={id} onClick={() => onNavigate(id)}>
            <Icon size={19} />
            <span>
              <strong>{t(title)}</strong>
              <small>{t(description)}</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
      <div className="page-stack">
        <OperationSummary status={farmStatus} onNavigate={onNavigate} />
        <div className="two-column">
          <Card className="panel">
            <div className="section-heading">
              <h2>{t("Atividade recente")}</h2>
              <a
                className="text-link"
                href="#activity"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("activity");
                }}
              >
                {t("Ver tudo ")}
                <ArrowUpRight size={16} />
              </a>
            </div>
            <div className="event-list">
              {events.length ? (
                events
                  .slice(0, 5)
                  .map((event, index) => (
                    <EventRow
                      key={index}
                      event={event}
                      label={accountsById.get(event.accountId)?.label}
                    />
                  ))
              ) : (
                <div className="empty-events">
                  {t(
                    "Os resultados aparecem aqui quando iniciares uma operação.",
                  )}
                </div>
              )}
            </div>
          </Card>
          <Card className="panel">
            <div className="section-heading">
              <h2>{t("Caixas recebidas")}</h2>
              <span>{t("Esta execução")}</span>
            </div>
            <div className="awards-grid">
              {awards.length ? (
                awards.slice(0, 6).map((award) => (
                  <article
                    className="award-row"
                    key={award.accountId + award.caseId}
                  >
                    <div>
                      <strong>{award.name}</strong>
                      <small>
                        {t(
                          accountsById.get(award.accountId)?.label ||
                            "Conta removida",
                        )}{" "}
                        · {t(formatTime(award.lastAt))}
                      </small>
                      {award.unverified > 0 && (
                        <small className="award-warning">
                          {t(award.unverified)}
                          {t(" pedidos sem leitura de confirmação")}
                        </small>
                      )}
                    </div>
                    <b>
                      {t("×")}
                      {t(formatNumber(award.count))}
                    </b>
                  </article>
                ))
              ) : (
                <div className="empty-events">
                  {t("As caixas geradas nesta execução aparecem aqui.")}
                </div>
              )}
            </div>
          </Card>
        </div>
        {!accounts.length && !loading && (
          <Card className="panel empty-state">
            <Users size={28} />
            <h2>{t("Começa pela tua primeira conta")}</h2>
            <p>
              {t(
                "Adiciona uma sessão para veres os saldos e configurares as operações.",
              )}
            </p>
            <Button onClick={() => onNavigate("accounts")}>
              {t("Adicionar conta")}
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}
