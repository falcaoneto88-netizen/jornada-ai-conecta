import { createFileRoute } from "@tanstack/react-router";
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
import { mascararTelefone, type Contact, type StageId } from "@/lib/demo-data";
import {
  useAutomacoes,
  useContactos,
  useEtapas,
  useGuardarMapeamentoEtapa,
  useModoDados,
  useMoverContacto,
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
      <div className="space-y-6">
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
      </div>

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
