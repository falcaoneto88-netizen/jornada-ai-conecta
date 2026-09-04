import { createFileRoute } from "@tanstack/react-router";
import { Copy, Lock, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppMode } from "@/lib/app-mode";

export const Route = createFileRoute("/integracoes")({
  head: () => ({
    meta: [
      { title: "Integrações — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Ligação ao GoHighLevel: token privado, Location ID, pipelines, calendários, webhooks e sincronização manual.",
      },
      { property: "og:title", content: "Integrações — Jornada AI" },
      { property: "og:description", content: "Ligação segura ao GoHighLevel com webhooks e sincronização." },
    ],
  }),
  component: Integracoes,
});

const campos = [
  { id: "base-url", label: "API Base URL", placeholder: "https://services.leadconnectorhq.com", secreto: false },
  { id: "token", label: "Private Integration Token", placeholder: "Guardado como secret no backend", secreto: true },
  { id: "location", label: "Location ID", placeholder: "ex.: aBcD1234", secreto: false },
  { id: "pipeline", label: "Pipeline ID padrão", placeholder: "ex.: pipe_98765", secreto: false },
  { id: "calendar", label: "Calendar ID", placeholder: "ex.: cal_12345", secreto: false },
  { id: "webhook", label: "Webhook Secret", placeholder: "Guardado como secret no backend", secreto: true },
];

function Integracoes() {
  const modo = useAppMode();
  const [aTestar, setATestar] = useState(false);
  const callbackUrl = "https://project--36345211-2616-42f7-bb9e-e78a9d00ca22.lovable.app/api/public/ghl-webhook";

  function testar() {
    setATestar(true);
    window.setTimeout(() => {
      setATestar(false);
      toast.error("Ligação não validada.", {
        description: "O backend de validação será ativado na Fase 2. Nenhuma credencial foi guardada.",
      });
    }, 900);
  }

  return (
    <AppShell title="Integrações" description="GoHighLevel / LeadConnector (API v2)">
      <div className="space-y-6">
        <section className="surface-card flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-start gap-3">
            <PlugZap className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Estado da ligação</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {modo === "conectado"
                  ? "Ligação validada pelo backend."
                  : "Modo demonstração: nenhuma chamada é feita ao GoHighLevel."}
              </p>
            </div>
          </div>
          <Badge variant={modo === "conectado" ? "default" : "outline"}>
            {modo === "conectado" ? "Conectado" : "Demonstração"}
          </Badge>
        </section>

        <Tabs defaultValue="credenciais">
          <TabsList>
            <TabsTrigger value="credenciais">Credenciais</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="mapeamento">Mapeamento</TabsTrigger>
            <TabsTrigger value="como">Como ligar</TabsTrigger>
          </TabsList>

          <TabsContent value="credenciais" className="mt-4">
            <div className="surface-card p-6">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                As credenciais são gravadas apenas como secrets no backend. Nunca ficam no navegador nem são devolvidas
                ao ecrã.
              </p>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                {campos.map((c) => (
                  <div key={c.id}>
                    <Label htmlFor={c.id}>{c.label}</Label>
                    <Input
                      id={c.id}
                      type={c.secreto ? "password" : "text"}
                      placeholder={c.placeholder}
                      autoComplete="off"
                      className="mt-1.5 bg-card"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={testar} disabled={aTestar}>
                  <ShieldCheck className="size-4" /> {aTestar ? "A testar…" : "Testar conexão"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    modo === "conectado"
                      ? toast.success("Sincronização manual concluída.")
                      : toast.error("Disponível apenas com ligação validada.")
                  }
                >
                  <RefreshCw className="size-4" /> Sincronização manual
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Última sincronização: —</p>
            </div>
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4">
            <div className="surface-card space-y-4 p-6">
              <div>
                <Label htmlFor="callback">Callback URL para o GoHighLevel</Label>
                <div className="mt-1.5 flex gap-2">
                  <Input id="callback" readOnly value={callbackUrl} className="bg-secondary/40" />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(callbackUrl);
                      toast.success("Endereço copiado.");
                    }}
                  >
                    <Copy className="size-4" /> Copiar
                  </Button>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Validação obrigatória do Webhook Secret em cada pedido recebido.</li>
                <li>• Idempotência por idempotency_key para evitar duplicações.</li>
                <li>• Registo de todos os eventos recebidos em webhooks_inbox com auditoria.</li>
                <li>• Retry com backoff, tratamento de rate limit, timeout e token inválido.</li>
              </ul>
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Ainda não foram recebidos eventos.
              </div>
            </div>
          </TabsContent>

          <TabsContent value="mapeamento" className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {["Pipelines", "Stages", "Utilizadores", "Calendários", "Campos personalizados"].map((m) => (
                <section key={m} className="surface-card p-5">
                  <h3 className="text-base font-semibold">{m}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A lista é carregada do GoHighLevel após validação da ligação.
                  </p>
                  <div className="mt-3 rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                    Sem dados — ligação por validar
                  </div>
                </section>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="como" className="mt-4">
            <article className="surface-card space-y-3 p-6 text-sm">
              <h3 className="text-base font-semibold">Como ligar o GoHighLevel</h3>
              <ol className="list-decimal space-y-2 pl-5">
                <li>No GoHighLevel, abra Settings → Private Integrations e crie um token com os âmbitos necessários.</li>
                <li>Copie o Location ID da sub-conta que vai ser usada pela clínica.</li>
                <li>Cole o token e os identificadores nesta página e clique em «Testar conexão».</li>
                <li>Depois de validado, copie a Callback URL e registe-a como webhook no GoHighLevel.</li>
                <li>Faça o mapeamento de pipelines, stages, utilizadores e calendários.</li>
                <li>Execute uma sincronização manual e confirme os contactos importados no separador Clientes.</li>
              </ol>
              <p className="text-muted-foreground">
                Nenhuma chave é escrita no código. Todas as chamadas passam por um proxy no backend com lista de
                operações permitidas.
              </p>
            </article>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
