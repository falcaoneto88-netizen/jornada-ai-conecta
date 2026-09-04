import { createFileRoute } from "@tanstack/react-router";
import { PlayCircle, Plus } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppMode } from "@/lib/app-mode";
import { automationRuns, automations, type Automation, type AutomationStatus } from "@/lib/demo-data";

export const Route = createFileRoute("/automacoes")({
  head: () => ({
    meta: [
      { title: "Automações — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Construtor visual de automações da jornada do paciente: gatilhos, condições e ações integradas ao GoHighLevel.",
      },
      { property: "og:title", content: "Automações — Jornada AI" },
      { property: "og:description", content: "Gatilhos, condições e ações da jornada do paciente." },
    ],
  }),
  component: Automacoes,
});

const gatilhos = [
  "Contacto criado",
  "Oportunidade mudou de etapa",
  "Mensagem recebida",
  "Consulta agendada",
  "Consulta confirmada",
  "Tempo sem resposta",
  "Data/hora relativa",
  "Webhook recebido",
];

const condicoes = [
  "Etapa",
  "Tag",
  "Canal",
  "Responsável",
  "Respondeu / não respondeu",
  "Status de agendamento",
];

const acoes = [
  "Enviar WhatsApp via GHL",
  "Enviar e-mail via GHL",
  "Enviar SMS via GHL",
  "Adicionar/remover tag",
  "Criar/atualizar oportunidade",
  "Mover etapa",
  "Atribuir responsável",
  "Criar tarefa",
  "Aguardar",
  "Chamar webhook",
  "Pedir sugestão à IA",
];

function statusBadge(status: AutomationStatus, demo: boolean) {
  if (status === "ativa") {
    return <Badge variant={demo ? "outline" : "default"}>{demo ? "Simulação" : "Ativa"}</Badge>;
  }
  if (status === "pausada") return <Badge variant="secondary">Pausada</Badge>;
  return <Badge variant="outline">Rascunho</Badge>;
}

function Automacoes() {
  const modo = useAppMode();
  const demo = modo !== "conectado";
  const [detalhe, setDetalhe] = useState<Automation | null>(null);
  const [novo, setNovo] = useState(false);

  return (
    <AppShell
      title="Automações"
      description="Construtor visual da jornada"
      actions={
        <Button onClick={() => setNovo(true)}>
          <Plus className="size-4" /> Nova automação
        </Button>
      }
    >
      <div className="space-y-6">
        <DemoNotice texto="Em modo demonstração as automações aparecem como «Simulação». Nenhuma execução chega ao GoHighLevel." />

        <Tabs defaultValue="lista">
          <TabsList>
            <TabsTrigger value="lista">Automações</TabsTrigger>
            <TabsTrigger value="blocos">Blocos disponíveis</TabsTrigger>
            <TabsTrigger value="logs">Log de execuções</TabsTrigger>
          </TabsList>

          <TabsContent value="lista" className="mt-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {automations.map((a) => (
                <article key={a.id} className="surface-card flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-heading">{a.nome}</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Gatilho: {a.gatilho} · v{a.versao}
                      </p>
                    </div>
                    {statusBadge(a.status, demo)}
                  </div>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm text-foreground">
                    {a.passos.map((p) => (
                      <li key={p} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                        {p}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Última execução: {a.ultimaExecucao}</span>
                    <span>
                      Sucesso {a.taxaSucesso}% · {a.erros} erro(s)
                    </span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDetalhe(a)}>
                      Ver detalhes
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        toast.success("Teste executado com cliente de demonstração.", {
                          description: `${a.nome} — simulação concluída sem envios reais.`,
                        })
                      }
                    >
                      <PlayCircle className="size-3.5" /> Testar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="blocos" className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                { titulo: "Gatilhos", itens: gatilhos },
                { titulo: "Condições", itens: condicoes },
                { titulo: "Ações", itens: acoes },
              ].map((grupo) => (
                <section key={grupo.titulo} className="surface-card p-5">
                  <h2 className="text-base font-semibold">{grupo.titulo}</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    {grupo.itens.map((i) => (
                      <li key={i} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                        {i}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="surface-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-heading text-background">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Automação</th>
                    <th className="px-4 py-3 text-left font-medium">Cliente</th>
                    <th className="px-4 py-3 text-left font-medium">Quando</th>
                    <th className="px-4 py-3 text-left font-medium">Estado</th>
                    <th className="px-4 py-3 text-left font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {automationRuns.map((r, i) => (
                    <tr key={r.id} className={i % 2 === 1 ? "bg-secondary/40" : undefined}>
                      <td className="px-4 py-3 text-heading">{r.automacao}</td>
                      <td className="px-4 py-3">{r.cliente}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.quando}</td>
                      <td className="px-4 py-3">
                        <Badge variant={r.estado === "erro" ? "destructive" : "outline"}>
                          {r.estado === "erro" ? "Erro" : r.estado === "simulado" ? "Simulação" : "Sucesso"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={detalhe !== null} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detalhe?.nome}</DialogTitle>
            <DialogDescription>
              Versão {detalhe?.versao} · Gatilho: {detalhe?.gatilho}
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 text-sm">
            {detalhe?.passos.map((p, i) => (
              <li key={p} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                {i + 1}. {p}
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova automação</DialogTitle>
            <DialogDescription>Comece pelo nome e pelo gatilho; os passos são adicionados a seguir.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nome da automação" aria-label="Nome da automação" />
            <Select>
              <SelectTrigger aria-label="Gatilho">
                <SelectValue placeholder="Escolher gatilho" />
              </SelectTrigger>
              <SelectContent>
                {gatilhos.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                toast.success("Automação criada como rascunho (demonstração).");
                setNovo(false);
              }}
            >
              Criar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
