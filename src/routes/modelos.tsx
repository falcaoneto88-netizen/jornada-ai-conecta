import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canalLabel, messageTemplates, stageName } from "@/lib/demo-data";
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
  const [idioma, setIdioma] = useState("todos");
  const [selecionado, setSelecionado] = useState(messageTemplates[0]!.id);
  const [corpo, setCorpo] = useState(messageTemplates[0]!.corpo);

  const lista = useMemo(
    () => messageTemplates.filter((t) => idioma === "todos" || t.idioma === idioma),
    [idioma],
  );

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
        <DemoNotice texto="Modelos DEMO. A IA melhora o texto mantendo tom acolhedor e premium, sem inventar valores ou promessas de resultado." />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <section className="surface-card overflow-hidden">
            <ul className="divide-y divide-border">
              {lista.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionado(t.id);
                      setCorpo(t.corpo);
                    }}
                    className={cn(
                      "w-full px-4 py-4 text-left transition-colors hover:bg-secondary/60",
                      t.id === selecionado && "bg-secondary",
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
                  Nenhum modelo neste idioma.
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
                <Button
                  variant="secondary"
                  onClick={() =>
                    toast.info("Melhoria por IA disponível após ativar a IA no backend (Fase 2).", {
                      description: "O tom acolhedor, premium e humano será preservado.",
                    })
                  }
                >
                  <Wand2 className="size-4" /> Melhorar com IA
                </Button>
                <Button onClick={() => toast.success("Modelo guardado (demonstração).")}>Guardar modelo</Button>
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
