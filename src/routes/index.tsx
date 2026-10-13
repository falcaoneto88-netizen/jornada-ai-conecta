import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, CalendarCheck, CheckCheck, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { AttendanceMyDay } from "@/components/attendance-my-day";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePainel } from "@/lib/dashboard";
import { formatarDataHora, formatarHora } from "@/lib/clinic-time";
import { rotuloEstadoMarcacao } from "@/lib/repo";
import { useSessao } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meu dia — Jornada AI" },
      {
        name: "description",
        content:
          "Agenda e indicadores dos contactos, consultas e oportunidades importados para a organização.",
      },
    ],
  }),
  component: VisaoGeral,
});

function VisaoGeral() {
  const [periodo, setPeriodo] = useState("30");
  const [diaAgenda, setDiaAgenda] = useState<"hoje" | "amanha">("hoje");
  const [todasEtapas, setTodasEtapas] = useState(false);
  const { modo, carregando } = useSessao();
  const painel = usePainel(Number(periodo));
  const dados = painel.data;
  const agenda = dados?.agenda[diaAgenda];
  const etapas = [...(dados?.distribuicao ?? [])].sort((a, b) => b.quantidade - a.quantidade);
  const etapasVisiveis = todasEtapas ? etapas : etapas.filter((e) => e.quantidade > 0).slice(0, 5);
  const etapasRestantes = etapas.length - etapasVisiveis.length;
  const maximo = Math.max(1, ...etapas.map((e) => e.quantidade));
  const cards = dados
    ? [
        {
          label: "Contactos adicionados à base",
          valor: dados.contactos,
          icon: UserPlus,
          criterio: "Inclui importações; não representa apenas novos leads.",
        },
        {
          label: "Marcações no período",
          valor: dados.marcacoes,
          icon: CalendarCheck,
          criterio: "Pela data da consulta, incluindo canceladas.",
        },
        {
          label: "Com estado Confirmada no app",
          valor: dados.confirmadas,
          icon: CheckCheck,
          criterio: `${dados.elegiveis} marcações elegíveis. Não comprova resposta SIM.`,
        },
        {
          label: "Oportunidades atualizadas",
          valor: dados.oportunidades,
          icon: Users,
          criterio: "Inclui sincronizações; não representa novas vendas.",
        },
      ]
    : [];

  return (
    <AppShell
      title="Meu dia"
      description="Retornos, consultas e próximos passos do atendimento"
      actions={
        <Button asChild>
          <Link to="/agenda">
            <CalendarCheck className="size-4" aria-hidden /> Abrir agenda
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {modo === "conta" && <AttendanceMyDay />}
        <details className="surface-card p-4 sm:p-5">
          <summary className="cursor-pointer font-semibold">Resumo da clínica</summary>
          <div className="mt-5 space-y-6">
            {modo === "demo" && (
              <section className="surface-card p-6">
                <h2 className="font-semibold">Modo demonstração</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  A agenda e os indicadores reais ficam disponíveis ao iniciar sessão. As outras
                  páginas de demonstração contêm exemplos identificados.
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link to="/auth" search={{ next: "" }}>
                    Iniciar sessão
                  </Link>
                </Button>
              </section>
            )}
            {(carregando || (modo === "conta" && painel.isPending)) && (
              <section role="status" className="surface-card p-6">
                <p className="font-medium">A carregar agenda e indicadores…</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A consultar os dados da organização.
                </p>
              </section>
            )}
            {modo === "conta" && painel.isError && (
              <section role="alert" className="surface-card p-6">
                <h2 className="font-semibold">Não foi possível carregar a visão geral.</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Uma falha na consulta não significa que não existam marcações ou contactos.
                </p>
                <Button variant="outline" className="mt-3" onClick={() => void painel.refetch()}>
                  Tentar novamente
                </Button>
              </section>
            )}
            {modo === "conta" && dados && !painel.isError && agenda && (
              <>
                <section className="surface-card overflow-hidden" aria-label="Agenda da clínica">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
                    <div>
                      <h2 className="text-base font-semibold">Agenda da clínica</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {agenda.dia.split("-").reverse().join("/")} · {dados.fuso}
                      </p>
                    </div>
                    <div
                      className="flex rounded-xl bg-secondary p-1"
                      role="group"
                      aria-label="Dia da agenda"
                    >
                      <Button
                        size="sm"
                        variant={diaAgenda === "hoje" ? "default" : "ghost"}
                        aria-pressed={diaAgenda === "hoje"}
                        onClick={() => setDiaAgenda("hoje")}
                      >
                        Hoje
                      </Button>
                      <Button
                        size="sm"
                        variant={diaAgenda === "amanha" ? "default" : "ghost"}
                        aria-pressed={diaAgenda === "amanha"}
                        onClick={() => setDiaAgenda("amanha")}
                      >
                        Amanhã
                      </Button>
                    </div>
                  </div>
                  {agenda.marcacoes.length === 0 ? (
                    <div className="px-5 py-8 sm:px-6" role="status">
                      <p className="font-medium">
                        Nenhuma marcação ativa importada para{" "}
                        {diaAgenda === "hoje" ? "hoje" : "amanhã"}.
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Consulte a agenda para outros dias e estados de marcação.
                      </p>
                    </div>
                  ) : (
                    <ul
                      className="divide-y divide-border"
                      aria-label={`Marcações de ${diaAgenda === "hoje" ? "hoje" : "amanhã"}`}
                    >
                      {agenda.marcacoes.map((m) => (
                        <li
                          key={m.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
                        >
                          <p className="w-14 shrink-0 text-lg font-semibold tabular-nums text-heading">
                            {formatarHora(m.start_at, dados.fuso)}
                          </p>
                          <div className="min-w-0 flex-1 basis-32">
                            <p className="break-words font-medium">
                              {m.contacts?.full_name ?? "Contacto por associar"}
                            </p>
                            <p className="mt-0.5 break-words text-sm text-muted-foreground">
                              {m.title}
                            </p>
                          </div>
                          <Badge variant="outline" className="whitespace-normal">
                            Estado no app: {rotuloEstadoMarcacao(m.status)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/20 px-5 py-3 sm:px-6">
                    <p className="text-xs text-muted-foreground">
                      Até 5 marcações ativas por dia, da base local.
                    </p>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/agenda">
                        Ver agenda completa <ArrowUpRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </section>

                <section className="space-y-4" aria-label="Indicadores do período">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Atividade da base local</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        De {dados.periodo.primeiroDia.split("-").reverse().join("/")} a{" "}
                        {dados.periodo.ultimoDia.split("-").reverse().join("/")}, incluindo hoje.
                      </p>
                    </div>
                    <Select value={periodo} onValueChange={setPeriodo}>
                      <SelectTrigger
                        className="w-[170px] bg-card"
                        aria-label="Período dos indicadores"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">Últimos 7 dias</SelectItem>
                        <SelectItem value="30">Últimos 30 dias</SelectItem>
                        <SelectItem value="90">Últimos 90 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {cards.map(({ label, valor, icon: Icon, criterio }) => (
                      <article key={label} className="surface-card p-5">
                        <div className="flex justify-between gap-3">
                          <h3 className="text-sm text-muted-foreground">{label}</h3>
                          <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                        </div>
                        <p className="mt-3 text-3xl font-semibold tabular-nums text-heading">
                          {valor}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">{criterio}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="surface-card p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        Etapa atual dos contactos adicionados
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Distribuição local no período. Não representa conversão nem as etapas do
                        GHL.
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/jornada">
                        Ver jornada <ArrowUpRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                  {dados.contactos === 0 ? (
                    <p className="mt-5 text-sm text-muted-foreground">
                      Nenhum contacto real adicionado neste período.
                    </p>
                  ) : (
                    <>
                      <ul
                        id="distribuicao-etapas"
                        className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2"
                      >
                        {etapasVisiveis.map((e) => (
                          <li key={e.key}>
                            <div className="flex justify-between gap-3 text-sm">
                              <span>{e.nome}</span>
                              <span className="tabular-nums">{e.quantidade}</span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-secondary">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{ width: `${(e.quantidade / maximo) * 100}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                      {(etapasRestantes > 0 || todasEtapas) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-4"
                          aria-expanded={todasEtapas}
                          aria-controls="distribuicao-etapas"
                          onClick={() => setTodasEtapas((atual) => !atual)}
                        >
                          {todasEtapas
                            ? "Mostrar menos etapas"
                            : `Mostrar mais ${etapasRestantes} ${etapasRestantes === 1 ? "etapa" : "etapas"}`}
                        </Button>
                      )}
                    </>
                  )}
                </section>

                <div className="space-y-3 text-xs text-muted-foreground">
                  <p>
                    Fonte: base local da organização, incluindo importações · Consultada em{" "}
                    {formatarDataHora(dados.consultadoEm, dados.fuso)}. Abrir esta página não força
                    sincronização com o GHL.
                  </p>
                  <details className="rounded-xl border border-border p-4">
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      Como estes dados são calculados
                    </summary>
                    <ul className="mt-3 list-disc space-y-2 pl-4 leading-relaxed">
                      <li>Contactos: criados na base local no período, incluindo importações.</li>
                      <li>
                        Marcações: pela data da consulta. A quantidade total inclui canceladas e
                        inválidas.
                      </li>
                      <li>
                        Estado Confirmada: {dados.confirmadas} de {dados.elegiveis} marcações não
                        canceladas ou inválidas. É o estado registado no app, não uma confirmação
                        recebida do paciente.
                      </li>
                      <li>
                        Oportunidades: atualizadas na base local no período, incluindo
                        sincronizações.
                      </li>
                      <li>
                        Agenda: até cinco marcações por dia, por horário, sem canceladas, inválidas,
                        realizadas ou faltas. Hoje e amanhã usam o fuso {dados.fuso} e não dependem
                        do filtro de indicadores.
                      </li>
                    </ul>
                  </details>
                  <p>
                    <strong className="font-medium">Indicadores ainda indisponíveis:</strong>{" "}
                    respostas SIM/NÃO, falhas de workflows GHL, orçamentos pendentes e conversão por
                    procedimento não têm dados integrados suficientes.
                  </p>
                </div>
              </>
            )}
          </div>
        </details>
      </div>
    </AppShell>
  );
}
