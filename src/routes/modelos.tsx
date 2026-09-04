import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canalLabel, stageName, type MessageTemplate } from "@/lib/demo-data";
import { useApagarModelo, useGuardarModelo, useModelos, useModoDados } from "@/lib/repo";
import { melhorarTexto } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/modelos")({
  head: () => ({
    meta: [
      { title: "Modelos de Mensagem — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Biblioteca de modelos por etapa, canal e idioma, com variáveis dinâmicas, pré-visualização e melhoria por IA.",
      },
      { property: "og:title", content: "Modelos de Mensagem — Jornada AI" },
      { property: "og:description", content: "Modelos por etapa, canal e idioma com variáveis dinâmicas." },
    ],
  }),
  component: Modelos,
});

const variaveisConhecidas = [
  "contact.first_name",
  "contact.last_name",
  "user.first_name",
  "appointment.date",
  "appointment.time",
  "clinic.name",
];

const exemplo: Record<string, string> = {
  "contact.first_name": "Mariana",
  "contact.last_name": "Coelho",
  "user.first_name": "Ana",
  "appointment.date": "08/09/2026",
  "appointment.time": "10:30",
  "clinic.name": "Clínica Dr. João Falcão",
};

function extrairVariaveis(texto: string): string[] {
  return [...texto.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]!);
}

function Modelos() {
  const { demo } = useModoDados();
  const { data: modelos = [], isLoading, error } = useModelos();
  const guardar = useGuardarModelo();
  const apagar = useApagarModelo();
  const melhorar = useServerFn(melhorarTexto);

  const [idioma, setIdioma] = useState("todos");
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [corpo, setCorpo] = useState("");
  const [aMelhorar, setAMelhorar] = useState(false);

  const lista = useMemo(
    () => modelos.filter((t) => idioma === "todos" || t.idioma === idioma),
    [idioma, modelos],
  );

  const selecionado: MessageTemplate | null =
    modelos.find((t) => t.id === selecionadoId) ?? modelos[0] ?? null;

  useEffect(() => {
    if (selecionado && selecionadoId === null) {
      setSelecionadoId(selecionado.id);
      setCorpo(selecionado.corpo);
    }
  }, [selecionado, selecionadoId]);

  async function melhorarComIa() {
    if (demo) {
      toast.error("A melhoria por IA exige conta iniciada.");
      return;
    }
    setAMelhorar(true);
    try {
      const res = await melhorar({ data: { texto: corpo } });
      if (res.ok) {
        setCorpo(res.texto);
        toast.success("Texto melhorado pela IA. Reveja antes de guardar.");
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Não foi possível contactar a IA.");
    } finally {
      setAMelhorar(false);
    }
  }

  async function guardarModelo() {
    if (demo) {
      toast.error("Guardar modelos exige conta iniciada.");
      return;
    }
    if (!selecionado) return;
    try {
      await guardar.mutateAsync({ ...selecionado, corpo });
      toast.success("Modelo guardado.");
    } catch {
      toast.error("Não foi possível guardar o modelo.");
    }
  }

  const usadas = extrairVariaveis(corpo);
  const invalidas = usadas.filter((v) => !variaveisConhecidas.includes(v));
  const previsualizacao = corpo.replace(/{{\s*([\w.]+)\s*}}/g, (_, v: string) => exemplo[v] ?? `{{${v}}}`);

  return (
    <AppShell
      title="Modelos de Mensagem"
      description="Biblioteca por etapa, canal e idioma"
      actions={
        <Select value={idioma} onValueChange={setIdioma}>
          <SelectTrigger className="w-[150px] bg-card" aria-label="Filtrar por idioma">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os idiomas</SelectItem>
            <SelectItem value="PT-PT">Português (PT)</SelectItem>
            <SelectItem value="PT-BR">Português (BR)</SelectItem>
            <SelectItem value="FR">Francês</SelectItem>
            <SelectItem value="ES">Espanhol</SelectItem>
            <SelectItem value="EN">Inglês</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-6">
        {demo && (
          <DemoNotice texto="Modelos DEMO. A IA melhora o texto mantendo tom acolhedor e premium, sem inventar valores ou promessas de resultado." />
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <section className="surface-card overflow-hidden">
            <ul className="divide-y divide-border">
              {lista.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionadoId(t.id);
                      setCorpo(t.corpo);
                    }}
                    className={cn(
                      "w-full px-4 py-4 text-left transition-colors hover:bg-secondary/60",
                      t.id === selecionado?.id && "bg-secondary",
                    )}
                  >
                    <p className="text-sm font-medium text-heading">{t.nome}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{stageName(t.etapa)}</Badge>
                      <Badge variant="secondary">{canalLabel[t.canal]}</Badge>
                      <Badge variant="outline">{t.idioma}</Badge>
                    </div>
                  </button>
                </li>
              ))}
              {lista.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {isLoading
                    ? "A carregar modelos…"
                    : error
                      ? "Não foi possível carregar os modelos."
                      : modelos.length === 0
                        ? "Ainda não há modelos. Carregue os dados DEMO em Configurações para começar."
                        : "Nenhum modelo neste idioma."}
                </li>
              )}
            </ul>
          </section>

          <section className="space-y-4">
            <div className="surface-card p-6">
              <h2 className="text-base font-semibold">Editor</h2>
              <Textarea
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                rows={7}
                aria-label="Corpo do modelo"
                className="mt-3 bg-card"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {variaveisConhecidas.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCorpo((c) => `${c}{{${v}}}`)}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-heading"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              {invalidas.length > 0 && (
                <p className="mt-3 text-sm text-destructive">
                  Variáveis desconhecidas: {invalidas.map((v) => `{{${v}}}`).join(", ")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void melhorarComIa()} disabled={aMelhorar || demo}>
                  <Wand2 className="size-4" /> {aMelhorar ? "A melhorar…" : "Melhorar com IA"}
                </Button>
                <Button onClick={() => void guardarModelo()} disabled={guardar.isPending || demo || invalidas.length > 0}>
                  {guardar.isPending ? "A guardar…" : "Guardar modelo"}
                </Button>
                {selecionado && !demo && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void apagar
                        .mutateAsync(selecionado.id)
                        .then(() => {
                          setSelecionadoId(null);
                          setCorpo("");
                          toast.success("Modelo apagado.");
                        })
                        .catch(() => toast.error("Não foi possível apagar o modelo."));
                    }}
                  >
                    Apagar
                  </Button>
                )}
              </div>
            </div>

            <div className="surface-card p-6">
              <p className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4 text-primary" aria-hidden /> Pré-visualização
              </p>
              <p className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-4 text-sm">
                {previsualizacao}
              </p>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
