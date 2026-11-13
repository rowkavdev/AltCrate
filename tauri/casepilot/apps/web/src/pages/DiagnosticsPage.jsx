import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { t } from "../language.js";
import React, { memo } from "react";
import RequestMetricsPanel from "./RequestMetricsPanel.jsx";
import {
  DIAGNOSTIC_FIELDS,
  displayValue,
  observedAt,
} from "./progressionHelpers.js";
import {
  useProgressionAccount,
  useProgression,
  ProgressionHeader,
  ProgressionState,
  ReadTime,
  ChangesTable,
} from "./progressionShared.jsx";
export const DiagnosticsContent = memo(function DiagnosticsContent({ data }) {
  const before = data.before,
    after = data.after,
    fields = Object.keys(DIAGNOSTIC_FIELDS).filter(
      (key) => before?.[key] != null || after?.[key] != null,
    ),
    changes = (data.changes || [])
      .filter((change) => DIAGNOSTIC_FIELDS[change.field])
      .map((change) => ({ ...change, label: DIAGNOSTIC_FIELDS[change.field] }));
  return (
    <>
      <section className="panel">
        <h3>{t("Diferenças observadas")}</h3>
        {changes.length ? (
          <ChangesTable changes={changes} />
        ) : (
          <p className="muted">
            {t(
              "Nenhuma diferença numérica observada entre as leituras disponíveis.",
            )}
          </p>
        )}
        <p className="form-note">
          {t(
            "Uma diferença observada não atribui a alteração a uma ação específica. Os resultados de operações só ficam confirmados após reconciliação.",
          )}
        </p>
      </section>
      <DisclosurePanel
        title="Leituras completas"
        description="Consultar os valores observados antes e depois."
      >
        <section className="panel">
          <h3>{t("Observações da conta")}</h3>
          <div className="diagnostic-observations">
            {[
              ["Antes", before],
              ["Depois", after],
            ].map(([label, snapshot]) => (
              <article key={label}>
                <span className="kicker">{t(label)}</span>
                <p className="form-note">
                  {t(observedAt(snapshot?.readAt || snapshot?.observedAt))}
                </p>
                {snapshot ? (
                  <dl className="progression-totals">
                    {fields.map((field) => (
                      <div key={field}>
                        <dt>{t(DIAGNOSTIC_FIELDS[field])}</dt>
                        <dd>{t(displayValue(snapshot[field]))}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">
                    {t(
                      "Sem observação anterior. Atualiza para comparar uma segunda leitura.",
                    )}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      </DisclosurePanel>
    </>
  );
});
export default function DiagnosticsPage({ model, ui = {}, onUiChange }) {
  const account = useProgressionAccount(model, ui),
    controller = useProgression({
      bridge: model.bridge,
      accountId: account?.id,
      scope: "diagnostics",
      load: () => model.bridge.readDiagnostics(account.id),
    });
  return (
    <div className="page-stack progression-page">
      <ProgressionHeader
        title="Diagnóstico"
        description="Consulta saldos virtuais, stock e contagens com as horas de observação."
        accounts={model.accounts}
        account={account}
        controller={controller}
        onUiChange={onUiChange}
      />
      <ProgressionState
        controller={controller}
        account={account}
        model={model}
      />

      {controller.data && (
        <>
          <DiagnosticsContent data={controller.data} />
          <ReadTime value={controller.data.readAt} />
        </>
      )}
      {model.bridge?.requestMetrics && (
        <DisclosurePanel
          title="Pedidos e limites"
          description="Fila, erros e tempos dos pedidos."
        >
          <RequestMetricsPanel bridge={model.bridge} />
        </DisclosurePanel>
      )}
    </div>
  );
}
