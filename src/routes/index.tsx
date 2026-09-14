import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, TrendingUp, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePainel } from "@/lib/dashboard";
import { formatarDataHora } from "@/lib/clinic-time";
import { useSessao } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visão Geral — Jornada AI" },
      {
        name: "description",
        content:
          "Indicadores dos contactos, consultas e oportunidades importados para a organização.",
      },
    ],
  }),
  component: VisaoGeral,
});

function VisaoGeral() {
  const [periodo, setPeriodo] = useState("30");
  const { modo, carregando } = useSessao();
  const painel = usePainel(Number(periodo));
  const dados = painel.data;
  const maximo = Math.max(1, ...(dados?.distribuicao.map((e) => e.quantidade) ?? []));
  const cards = dados
    ? [
        {
          label: "Contactos adicionados",
          valor: dados.contactos,
          icon: UserPlus,
          criterio: "Criados na base local no período, incluindo importações.",
        },
        {
          label: "Marcações no período",
          valor: dados.marcacoes,
          icon: CalendarCheck,
          criterio: "Pela data da consulta; inclui canceladas.",
        },
        {
          label: "Estado «Confirmada» no app",
          valor: dados.taxaConfirmacao === null ? "—" : `${dados.taxaConfirmacao}%`,
          icon: TrendingUp,
          criterio: `${dados.confirmadas} de ${dados.elegiveis} marcações não canceladas/inválidas. Estado registrado no app; não comprova resposta SIM.`,
        },
        {
          label: "Oportunidades atualizadas",
          valor: dados.oportunidades,
          icon: Users,
          criterio: "Atualizadas na base local no período, incluindo sincronizações.",
        },
      ]
    : [];

  return (
    <AppShell
      title="Visão Geral"
      description="Dados importados da organização"
      actions={
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-[170px] bg-card" aria-label="Período">
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
        {modo === "demo" && (
          <section className="surface-card p-6">
            <h2 className="font-semibold">Modo demonstração</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Os indicadores reais ficam disponíveis ao iniciar sessão. As outras páginas de
              demonstração contêm exemplos identificados.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/auth" search={{ next: "" }}>
                Iniciar sessão
              </Link>
            </Button>
          </section>
        )}
        {(carregando || (modo === "conta" && painel.isPending)) && (
          <p role="status">A carregar indicadores…</p>
        )}
        {modo === "conta" && painel.isError && (
          <section role="alert" className="surface-card p-6">
            <p>Não foi possível carregar os indicadores da organização.</p>
            <Button variant="outline" className="mt-3" onClick={() => void painel.refetch()}>
              Tentar novamente
            </Button>
          </section>
        )}
        {modo === "conta" && dados && !painel.isError && (
          <>
            <p className="text-sm text-muted-foreground">
              De {dados.periodo.primeiroDia} a {dados.periodo.ultimoDia}, incluindo hoje. Horário da
              clínica: <strong>{dados.fuso}</strong>. Dados consultados em{" "}
              {formatarDataHora(dados.consultadoEm, dados.fuso)}. A consulta ao app não força nova
              sincronização com o GHL.
            </p>
            <section
              aria-label="Indicadores do período"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {cards.map(({ label, valor, icon: Icon, criterio }) => (
                <article key={label} className="surface-card p-5">
                  <div className="flex justify-between gap-3">
                    <h2 className="text-sm text-muted-foreground">{label}</h2>
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                  </div>
                  <p className="mt-3 text-3xl font-semibold text-heading">{valor}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{criterio}</p>
                </article>
              ))}
            </section>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
              <section className="surface-card p-6 lg:col-span-3">
                <h2 className="text-base font-semibold">Etapa atual dos contactos adicionados</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Distribuição local dos contactos criados no período. Não representa conversão
                  histórica nem a etapa da oportunidade no GHL.
                </p>
                {dados.contactos === 0 ? (
                  <p className="mt-5 text-sm">Nenhum contacto real adicionado neste período.</p>
                ) : (
                  <ul className="mt-6 space-y-4">
                    {dados.distribuicao.map((e) => (
                      <li key={e.key}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span>{e.nome}</span>
                          <span>{e.quantidade}</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-secondary">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${(e.quantidade / maximo) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="outline" className="mt-5">
                  <Link to="/jornada">Ver jornada</Link>
                </Button>
              </section>
              <section className="surface-card p-6 lg:col-span-2">
                <h2 className="text-base font-semibold">Próximas consultas de amanhã</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Até cinco marcações no horário da clínica, independentemente do filtro de
                  indicadores.
                </p>
                {dados.proximas.length === 0 ? (
                  <p className="mt-5 text-sm">Nenhuma marcação válida importada para amanhã.</p>
                ) : (
                  <ul className="mt-5 space-y-3">
                    {dados.proximas.map((m) => (
                      <li key={m.id} className="rounded-xl border border-border p-4">
                        <p className="font-medium">
                          {m.contacts?.full_name ?? "Contacto por associar"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatarDataHora(m.start_at, dados.fuso)} · {m.title}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="outline" className="mt-5">
                  <Link to="/agenda">Ver agenda</Link>
                </Button>
              </section>
            </div>
            <section className="surface-card p-5">
              <h2 className="text-sm font-semibold">Indicadores ainda indisponíveis</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Respostas SIM/NÃO, falhas de workflows GHL, orçamentos pendentes e conversão por
                procedimento ainda não têm dados integrados suficientes para um indicador confiável.
              </p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
