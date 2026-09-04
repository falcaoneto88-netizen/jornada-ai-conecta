import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarCheck, FileText, HeartPulse, TrendingUp, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acoesPrioritarias, funil, kpis } from "@/lib/demo-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visão Geral — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Painel clínico com KPIs de leads, consultas, orçamentos e automações da jornada do cliente integrada ao GoHighLevel.",
      },
      { property: "og:title", content: "Visão Geral — Jornada AI | Dr. João Falcão" },
      {
        property: "og:description",
        content: "KPIs de leads, consultas, orçamentos e automações da jornada do cliente.",
      },
    ],
  }),
  component: VisaoGeral,
});

const kpiCards = [
  { label: "Novos leads", valor: kpis.novosLeads, icon: UserPlus },
  { label: "Consultas agendadas", valor: kpis.consultasAgendadas, icon: CalendarCheck },
  { label: "Taxa de confirmação", valor: `${kpis.taxaConfirmacao}%`, icon: TrendingUp },
  { label: "Orçamentos pendentes", valor: kpis.orcamentosPendentes, icon: FileText },
  { label: "Procedimentos agendados", valor: kpis.procedimentosAgendados, icon: HeartPulse },
  { label: "Pacientes em follow-up", valor: kpis.pacientesFollowUp, icon: Users },
  { label: "Automações com erro", valor: kpis.automacoesComErro, icon: AlertTriangle },
];

function VisaoGeral() {
  const [periodo, setPeriodo] = useState("30");
  const maximo = Math.max(...funil.map((f) => f.valor));

  return (
    <AppShell
      title="Visão Geral"
      description="Desempenho da jornada do cliente"
      actions={
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-[150px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-6">
        <DemoNotice texto="Está em modo demonstração. Os números apresentados são dados DEMO e não provêm do GoHighLevel." />

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map(({ label, valor, icon: Icon }) => (
            <article key={label} className="surface-card p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Icon className="size-4 text-primary" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-semibold text-heading">{valor}</p>
            </article>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="surface-card p-6 lg:col-span-3">
            <h2 className="text-base font-semibold">Conversão por etapa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Contactos por etapa da jornada no período escolhido.</p>
            <ul className="mt-6 space-y-4">
              {funil.map((f) => (
                <li key={f.etapa}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{f.etapa}</span>
                    <span className="font-medium text-heading">{f.valor}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-secondary">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{ width: `${(f.valor / maximo) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="surface-card p-6 lg:col-span-2">
            <h2 className="text-base font-semibold">Ações prioritárias</h2>
            <p className="mt-1 text-sm text-muted-foreground">O que precisa de atenção da equipa hoje.</p>
            <ul className="mt-5 space-y-3">
              {acoesPrioritarias.map((a) => (
                <li key={a.tipo + a.cliente} className="rounded-xl border border-border bg-secondary/40 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-heading">{a.cliente}</p>
                    <Badge variant={a.urgencia === "alta" ? "destructive" : "secondary"}>
                      {a.urgencia === "alta" ? "Urgente" : "Atenção"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{a.tipo}</p>
                  <p className="text-xs text-muted-foreground">{a.detalhe}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
