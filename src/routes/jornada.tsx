import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mascararTelefone, type Contact, type StageId } from "@/lib/demo-data";
import { sincronizarOportunidadesGhl } from "@/lib/ghl-pipelines.functions";
import {
  useAutomacoes,
  useContactos,
  useEtapas,
  useEtapasPipeline,
  useGuardarMapeamentoEtapa,
  useLigacaoGhl,
  useModoDados,
  useMoverContacto,
  useOportunidades,
  usePermissoes,
} from "@/lib/repo";


export const Route = createFileRoute("/jornada")({
  head: () => ({
    meta: [
      { title: "Jornada do Cliente — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Kanban da jornada do paciente, do novo lead à reativação, com automações associadas e mapeamento para o GoHighLevel.",
      },
      { property: "og:title", content: "Jornada do Cliente — Jornada AI" },
      { property: "og:description", content: "Kanban da jornada do paciente com automações associadas." },
    ],
  }),
  component: Jornada,
});

function automacoesDaEtapa(etapa: StageId): string[] {
  const mapa: Partial<Record<StageId, string[]>> = {
    novo_lead: ["Novo lead — resposta imediata"],
    consulta_agendada: ["Consulta agendada — boas-vindas", "Consulta D-1 — confirmação e preparo"],
    consulta_confirmada: ["Consulta confirmada — agradecimento"],
    orcamento_enviado: ["Pós-consulta — orçamento e follow-up"],
    procedimento_agendado: ["Procedimento agendado — acolhimento"],
    pos_procedimento: ["Pós-procedimento D+0, D+2, D+5 e D+7"],
    reativacao: ["4 dias sem resposta — reativação"],
  };
  return mapa[etapa] ?? [];
}

const ESTADOS: { valor: string; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "open", rotulo: "Em aberto" },
  { valor: "won", rotulo: "Ganhas" },
  { valor: "lost", rotulo: "Perdidas" },
  { valor: "abandoned", rotulo: "Abandonadas" },
];

const ROTULO_ESTADO: Record<string, string> = {
  open: "Em aberto",
  won: "Ganha",
  lost: "Perdida",
  abandoned: "Abandonada",
};

function euros(valor: number | null) {
  if (valor == null) return "—";
  return valor.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

function QuadroOportunidades() {
  const { demo } = useModoDados();
  const permissoes = usePermissoes();
  const { data: ligacao } = useLigacaoGhl();
  const pipelineId = ligacao?.default_pipeline_id ?? null;
  const etapas = useEtapasPipeline(pipelineId);
  const oportunidades = useOportunidades(pipelineId);
  const sincronizar = useServerFn(sincronizarOportunidadesGhl);
  const [estado, setEstado] = useState("todos");
  const [aSincronizar, setASincronizar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);

  async function importar() {
    setASincronizar(true);
    try {
      const res = await sincronizar();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.resultado;
      const resumo = `${r.inseridas} novas, ${r.atualizadas} atualizadas`;
      setOcorrencias(r.conflitos);
      if (r.completo) toast.success(`Sincronização em leitura concluída: ${resumo}.`);
      else
        toast.warning(
          `Sincronização incompleta: ${resumo}${r.adiadas ? `, ${r.adiadas} adiada(s)` : ""}. ${r.conflitos.length} ocorrência(s).`,
        );
      await Promise.all([etapas.refetch(), oportunidades.refetch()]);
    } catch {
      toast.error("Não foi possível sincronizar as oportunidades.");
    } finally {
      setASincronizar(false);
    }
  }

  if (demo) {
    return (
      <DemoNotice texto="As oportunidades vêm da conta real do GoHighLevel. Inicie sessão para as consultar." />
    );
  }

  if (!pipelineId) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nenhum funil ligado. Escolha o funil em Integrações › Mapeamento.
      </div>
    );
  }

  if (etapas.isLoading || oportunidades.isLoading) {
    return (
      <div className="rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
        A carregar oportunidades…
      </div>
    );
  }

  if (etapas.error || oportunidades.error) {
    return (
      <div className="rounded-2xl border border-destructive/40 p-8 text-center text-sm text-destructive">
        Não foi possível carregar as oportunidades desta conta.
      </div>
    );
  }

  const visiveis = (oportunidades.data ?? []).filter((o) => estado === "todos" || o.estado === estado);
  const chavesEtapas = new Set((etapas.data ?? []).map((e) => e.key));
  const naoMapeadas = visiveis.filter((o) => !o.etapa || !chavesEtapas.has(o.etapa));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {ESTADOS.map((e) => (
            <Button
              key={e.valor}
              size="sm"
              variant={estado === e.valor ? "default" : "outline"}
              onClick={() => setEstado(e.valor)}
            >
              {e.rotulo}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {visiveis.length} oportunidade(s) · leitura apenas
            {naoMapeadas.length > 0 ? ` · ${naoMapeadas.length} por mapear` : ""}
          </span>
          {permissoes.gerirIntegracao && (
            <Button variant="outline" size="sm" onClick={() => void importar()} disabled={aSincronizar}>
              <RefreshCw className="size-4" /> {aSincronizar ? "A sincronizar…" : "Sincronizar"}
            </Button>
          )}
        </div>
      </div>

      {ocorrencias.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="text-sm font-semibold">Ocorrências da última sincronização ({ocorrencias.length})</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {ocorrencias.slice(0, 10).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {(etapas.data ?? []).map((etapa) => {
          const cards = visiveis.filter((o) => o.etapa === etapa.key);
          const total = cards.reduce((s, o) => s + (o.valor ?? 0), 0);
          return (
            <section
              key={etapa.key}
              className="w-[272px] shrink-0 rounded-2xl border border-border bg-secondary/40 p-3"
              aria-label={etapa.nome}
            >
              <header className="px-1 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-heading">{etapa.nome}</h2>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                    {cards.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{euros(total)}</p>
              </header>
              <ul className="space-y-2">
                {cards.map((o) => (
                  <li key={o.id} className="rounded-xl border border-border bg-card p-3 shadow-soft">
                    <p className="text-sm font-medium text-heading">{o.contacto}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{o.nome}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-heading">{euros(o.valor)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ROTULO_ESTADO[o.estado] ?? o.estado}
                      </Badge>
                    </div>
                  </li>
                ))}
                {cards.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Sem oportunidades nesta etapa
                  </li>
                )}
              </ul>
            </section>
          );
        })}

        {naoMapeadas.length > 0 && (
          <section
            className="w-[272px] shrink-0 rounded-2xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3"
            aria-label="Oportunidades por mapear"
          >
            <header className="px-1 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-heading">Por mapear</h2>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                  {naoMapeadas.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Etapa do GoHighLevel ainda sem correspondência.</p>
            </header>
            <ul className="space-y-2">
              {naoMapeadas.map((o) => (
                <li key={o.id} className="rounded-xl border border-border bg-card p-3 shadow-soft">
                  <p className="text-sm font-medium text-heading">{o.contacto}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{o.nome}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-heading">{euros(o.valor)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {ROTULO_ESTADO[o.estado] ?? o.estado}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Esta ligação está em modo leitura: os cartões refletem o GoHighLevel e não podem ser arrastados.
      </p>
    </div>
  );
}

function Jornada() {

  const { demo } = useModoDados();
  const { data: contactos = [], isLoading } = useContactos();
  const { data: journeyStages = [] } = useEtapas();
  const { data: automations = [] } = useAutomacoes();
  const mover = useMoverContacto();
  const guardarMapeamento = useGuardarMapeamentoEtapa();

  const [locais, setLocais] = useState<Record<string, StageId>>({});
  const [mapaEdicao, setMapaEdicao] = useState<Record<string, { pipeline: string; stage: string }>>({});
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [pendente, setPendente] = useState<{ contact: Contact; destino: StageId } | null>(null);
  const [detalhe, setDetalhe] = useState<Contact | null>(null);
  const [mapeamento, setMapeamento] = useState(false);

  const lista = contactos.map((c) => (locais[c.id] ? { ...c, etapa: locais[c.id]! } : c));

  function soltar(destino: StageId) {
    const contacto = lista.find((c) => c.id === arrastado);
    setArrastado(null);
    if (!contacto || contacto.etapa === destino) return;
    setPendente({ contact: contacto, destino });
  }

  async function confirmar() {
    if (!pendente) return;
    const { contact, destino } = pendente;
    const nome = journeyStages.find((s) => s.id === destino)?.nome;
    setPendente(null);

    if (demo) {
      setLocais((a) => ({ ...a, [contact.id]: destino }));
      toast.success(`${contact.nome} movido para ${nome}.`, {
        description: "Automações executadas em simulação (modo demonstração).",
      });
      return;
    }

    try {
      await mover.mutateAsync({ id: contact.id, etapa: destino, nome: contact.nome });
      toast.success(`${contact.nome} movido para ${nome}.`, {
        description: "Alteração gravada e registada na auditoria.",
      });
    } catch {
      toast.error("Não foi possível mover o cliente. Tente novamente.");
    }
  }

  async function guardarMapeamentos() {
    if (demo) {
      toast.error("O mapeamento só pode ser gravado com uma conta iniciada.");
      return;
    }
    try {
      await Promise.all(
        Object.entries(mapaEdicao).map(([key, v]) =>
          guardarMapeamento.mutateAsync({
            key,
            pipelineId: v.pipeline.trim() || null,
            stageId: v.stage.trim() || null,
          }),
        ),
      );
      toast.success("Mapeamento guardado.");
      setMapeamento(false);
    } catch {
      toast.error("Não foi possível guardar o mapeamento.");
    }
  }

  return (
    <AppShell
      title="Jornada do Cliente"
      description="Do primeiro contacto à reativação"
      actions={
        <Button variant="outline" onClick={() => setMapeamento(true)}>
          Mapear etapas no GHL
        </Button>
      }
    >
      <Tabs defaultValue="contactos" className="space-y-6">
        <TabsList>
          <TabsTrigger value="contactos">Contactos</TabsTrigger>
          <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
        </TabsList>

        <TabsContent value="contactos" className="space-y-6">
          {demo && (
            <DemoNotice texto="Arraste os cartões entre etapas. Em modo demonstração, as automações são apenas simuladas." />
          )}

          <div className="flex gap-4 overflow-x-auto pb-4">
            {journeyStages.map((etapa) => {
              const cards = lista.filter((c) => c.etapa === etapa.id);
              return (
                <section
                  key={etapa.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => soltar(etapa.id)}
                  className="w-[272px] shrink-0 rounded-2xl border border-border bg-secondary/40 p-3"
                  aria-label={etapa.nome}
                >
                  <header className="flex items-center justify-between px-1 pb-3">
                    <h2 className="text-sm font-semibold text-heading">{etapa.nome}</h2>
                    <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                      {cards.length}
                    </span>
                  </header>
                  <ul className="space-y-2">
                    {cards.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setArrastado(c.id)}
                          onClick={() => setDetalhe(c)}
                          className="w-full cursor-grab rounded-xl border border-border bg-card p-3 text-left shadow-soft transition-shadow hover:shadow-card active:cursor-grabbing"
                        >
                          <p className="text-sm font-medium text-heading">{c.nome}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{c.proximaAcao}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.tags.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px]">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      </li>
                    ))}
                    {cards.length === 0 && (
                      <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        {isLoading ? "A carregar…" : "Sem clientes nesta etapa"}
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="oportunidades" className="space-y-4">
          <QuadroOportunidades />
        </TabsContent>
      </Tabs>


      <Dialog open={pendente !== null} onOpenChange={(o) => !o && setPendente(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar mudança de etapa</DialogTitle>
            <DialogDescription>
              {pendente &&
                `${pendente.contact.nome} passa para ${journeyStages.find((s) => s.id === pendente.destino)?.nome}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium text-heading">Automações que serão disparadas</p>
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {pendente && automacoesDaEtapa(pendente.destino).length > 0 ? (
                automacoesDaEtapa(pendente.destino).map((a) => <li key={a}>• {a}</li>)
              ) : (
                <li className="text-muted-foreground">Nenhuma automação associada a esta etapa.</li>
              )}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendente(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmar()} disabled={mover.isPending}>
              {mover.isPending ? "A guardar…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detalhe !== null} onOpenChange={(o) => !o && setDetalhe(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detalhe?.nome}</SheetTitle>
            <SheetDescription>Ficha do cliente e histórico da jornada.</SheetDescription>
          </SheetHeader>
          {detalhe && (
            <div className="space-y-5 px-4 pb-8">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Telefone</dt>
                  <dd className="text-heading">{mascararTelefone(detalhe.telefone)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd className="truncate text-heading">{detalhe.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Origem</dt>
                  <dd className="text-heading">{detalhe.origem}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Responsável</dt>
                  <dd className="text-heading">{detalhe.responsavel}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Próxima ação</dt>
                  <dd className="text-heading">{detalhe.proximaAcao}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Agendamento</dt>
                  <dd className="text-heading">{detalhe.agendamento ?? "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                {detalhe.tags.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-heading">Histórico</h3>
                <ol className="mt-3 space-y-3 border-l border-border pl-4">
                  {detalhe.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                      <p className="text-sm font-medium text-heading">{t.titulo}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.data} — {t.detalhe}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={mapeamento} onOpenChange={setMapeamento}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mapeamento de etapas no GoHighLevel</DialogTitle>
            <DialogDescription>
              Indique o Pipeline ID e o Stage ID correspondentes de cada etapa.
              {demo && " Disponível apenas com conta iniciada."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {journeyStages.map((s) => {
              const valor = mapaEdicao[s.id] ?? {
                pipeline: s.ghlPipelineId ?? "",
                stage: s.ghlStageId ?? "",
              };
              return (
                <div key={s.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-3">
                  <p className="text-sm text-heading">{s.nome}</p>
                  <Input
                    placeholder="Pipeline ID"
                    aria-label={`Pipeline ID de ${s.nome}`}
                    disabled={demo}
                    value={valor.pipeline}
                    onChange={(e) =>
                      setMapaEdicao((a) => ({ ...a, [s.id]: { ...valor, pipeline: e.target.value } }))
                    }
                  />
                  <Input
                    placeholder="Stage ID"
                    aria-label={`Stage ID de ${s.nome}`}
                    disabled={demo}
                    value={valor.stage}
                    onChange={(e) =>
                      setMapaEdicao((a) => ({ ...a, [s.id]: { ...valor, stage: e.target.value } }))
                    }
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMapeamento(false)}>
              Fechar
            </Button>
            <Button onClick={() => void guardarMapeamentos()} disabled={demo || guardarMapeamento.isPending}>
              {guardarMapeamento.isPending ? "A guardar…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="sr-only">{automations.length} automações configuradas</p>
    </AppShell>
  );
}
