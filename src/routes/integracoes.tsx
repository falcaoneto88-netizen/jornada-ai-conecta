import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Lock, PlugZap, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getGhlSecretsStatus, syncGhl, testGhlConnection } from "@/lib/ghl.functions";
import { useGuardarLigacaoGhl, useLigacaoGhl, useModoDados, useWebhooks } from "@/lib/repo";

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

const CALLBACK_URL =
  "https://project--36345211-2616-42f7-bb9e-e78a9d00ca22.lovable.app/api/public/ghl-webhook";

type EstadoSecrets = { token: boolean; locationId: boolean; webhookSecret: boolean; ia: boolean };

function LinhaSecret({ nome, ativo, descricao }: { nome: string; ativo: boolean; descricao: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border p-3">
      {ativo ? (
        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="font-mono text-sm break-all">{nome}</p>
        <p className="text-xs text-muted-foreground">{ativo ? "Configurado no backend." : descricao}</p>
      </div>
    </li>
  );
}

function Integracoes() {
  const { demo } = useModoDados();
  const { data: ligacao } = useLigacaoGhl();
  const { data: webhooks = [] } = useWebhooks(10);
  const guardar = useGuardarLigacaoGhl();
  const verSecrets = useServerFn(getGhlSecretsStatus);
  const testar = useServerFn(testGhlConnection);
  const sincronizar = useServerFn(syncGhl);

  const [secrets, setSecrets] = useState<EstadoSecrets | null>(null);
  const [aTestar, setATestar] = useState(false);
  const [aSincronizar, setASincronizar] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://services.leadconnectorhq.com");
  const [versao, setVersao] = useState("2021-07-28");
  const [pipeline, setPipeline] = useState("");
  const [calendario, setCalendario] = useState("");
  const [escrita, setEscrita] = useState(false);

  useEffect(() => {
    if (demo) return;
    void verSecrets().then(setSecrets).catch(() => setSecrets(null));
  }, [demo, verSecrets]);

  useEffect(() => {
    if (!ligacao) return;
    setBaseUrl(ligacao.api_base_url ?? "https://services.leadconnectorhq.com");
    setVersao(ligacao.api_version ?? "2021-07-28");
    setPipeline(ligacao.default_pipeline_id ?? "");
    setCalendario(ligacao.calendar_id ?? "");
    setEscrita(Boolean(ligacao.write_enabled));
  }, [ligacao]);

  const conectada = ligacao?.status === "conectada";

  async function testarLigacao() {
    if (demo) {
      toast.error("Inicie sessão numa conta para testar a ligação.");
      return;
    }
    setATestar(true);
    try {
      const res = await testar();
      if (res.ok) toast.success(`Ligação validada: ${res.locationName ?? "conta GoHighLevel"}.`);
      else toast.error(res.message);
    } catch {
      toast.error("Não foi possível concluir o teste de ligação.");
    } finally {
      setATestar(false);
    }
  }

  async function sincronizarAgora() {
    if (demo) {
      toast.error("Sincronização indisponível em modo demonstração.");
      return;
    }
    setASincronizar(true);
    try {
      const res = await sincronizar();
      if (res.ok) toast.success(`Sincronização em leitura concluída: ${res.importados} contactos.`);
      else toast.error(res.message);
    } catch {
      toast.error("Falha na sincronização.");
    } finally {
      setASincronizar(false);
    }
  }

  function guardarConfig() {
    if (demo) {
      toast.error("Configuração indisponível em modo demonstração.");
      return;
    }
    guardar.mutate(
      {
        api_base_url: baseUrl,
        api_version: versao,
        default_pipeline_id: pipeline || null,
        calendar_id: calendario || null,
        write_enabled: escrita,
      },
      {
        onSuccess: () => toast.success("Configuração guardada."),
        onError: () => toast.error("Não foi possível guardar a configuração."),
      },
    );
  }

  return (
    <AppShell title="Integrações" description="GoHighLevel / LeadConnector (API v2)">
      <div className="space-y-6">
        {demo && <DemoNotice texto="Modo demonstração: nenhuma chamada é feita ao GoHighLevel." />}

        <section className="surface-card flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-start gap-3">
            <PlugZap className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Estado da ligação</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {demo
                  ? "Modo demonstração."
                  : conectada
                    ? `Ligação validada${ligacao?.last_tested_at ? ` em ${new Date(ligacao.last_tested_at).toLocaleString("pt-PT")}` : ""}.`
                    : "Ligação por validar. Teste a conexão para confirmar as credenciais."}
              </p>
            </div>
          </div>
          <Badge variant={conectada ? "default" : "outline"}>
            {demo ? "Demonstração" : conectada ? "Conectado" : "Por validar"}
          </Badge>
        </section>

        <Tabs defaultValue="credenciais">
          <TabsList className="flex-wrap">
            <TabsTrigger value="credenciais">Credenciais</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="mapeamento">Mapeamento</TabsTrigger>
            <TabsTrigger value="guia">Guia de conexão</TabsTrigger>
          </TabsList>

          <TabsContent value="credenciais" className="mt-4">
            <div className="surface-card space-y-5 p-6">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                O token privado, o Location ID e o segredo do webhook vivem apenas como secrets do backend. Não existem
                campos para os escrever aqui: o administrador regista-os em Definições do projeto › Secrets.
              </p>

              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <LinhaSecret
                  nome="GHL_PRIVATE_TOKEN"
                  ativo={Boolean(secrets?.token)}
                  descricao="Em falta — o administrador precisa de o registar no backend."
                />
                <LinhaSecret
                  nome="GHL_LOCATION_ID"
                  ativo={Boolean(secrets?.locationId)}
                  descricao="Em falta — identificador da sub-conta do GoHighLevel."
                />
                <LinhaSecret
                  nome="GHL_WEBHOOK_SECRET"
                  ativo={Boolean(secrets?.webhookSecret)}
                  descricao="Em falta — necessário para validar os eventos recebidos."
                />
                <LinhaSecret
                  nome="LOVABLE_API_KEY (IA)"
                  ativo={Boolean(secrets?.ia)}
                  descricao="IA não configurada — resumos e sugestões ficam indisponíveis."
                />
              </ul>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="base-url">API Base URL</Label>
                  <Input
                    id="base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={demo}
                    className="mt-1.5 bg-card"
                  />
                </div>
                <div>
                  <Label htmlFor="versao">Version header</Label>
                  <Input
                    id="versao"
                    value={versao}
                    onChange={(e) => setVersao(e.target.value)}
                    disabled={demo}
                    className="mt-1.5 bg-card"
                  />
                </div>
                <div>
                  <Label htmlFor="pipeline">Pipeline ID padrão</Label>
                  <Input
                    id="pipeline"
                    value={pipeline}
                    onChange={(e) => setPipeline(e.target.value)}
                    placeholder="ex.: pipe_98765"
                    disabled={demo}
                    className="mt-1.5 bg-card"
                  />
                </div>
                <div>
                  <Label htmlFor="calendario">Calendar ID</Label>
                  <Input
                    id="calendario"
                    value={calendario}
                    onChange={(e) => setCalendario(e.target.value)}
                    placeholder="ex.: cal_12345"
                    disabled={demo}
                    className="mt-1.5 bg-card"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Permitir escrita no GoHighLevel</p>
                  <p className="text-xs text-muted-foreground">
                    Só deve ser ativada depois de validar a sincronização em modo leitura.
                  </p>
                </div>
                <Switch
                  checked={escrita}
                  onCheckedChange={setEscrita}
                  disabled={demo || !conectada}
                  aria-label="Permitir escrita no GoHighLevel"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void testarLigacao()} disabled={aTestar || demo}>
                  <ShieldCheck className="size-4" /> {aTestar ? "A testar…" : "Testar conexão"}
                </Button>
                <Button variant="outline" onClick={() => void sincronizarAgora()} disabled={aSincronizar || demo}>
                  <RefreshCw className="size-4" /> {aSincronizar ? "A sincronizar…" : "Sincronização (leitura)"}
                </Button>
                <Button variant="outline" onClick={guardarConfig} disabled={demo || guardar.isPending}>
                  Guardar configuração
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Última sincronização:{" "}
                {ligacao?.last_sync_at ? new Date(ligacao.last_sync_at).toLocaleString("pt-PT") : "—"}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4">
            <div className="surface-card space-y-4 p-6">
              <div>
                <Label htmlFor="callback">Callback URL para o GoHighLevel</Label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <Input id="callback" readOnly value={CALLBACK_URL} className="bg-secondary/40" />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(CALLBACK_URL);
                      toast.success("Endereço copiado.");
                    }}
                  >
                    <Copy className="size-4" /> Copiar
                  </Button>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Validação obrigatória do segredo (cabeçalho direto ou assinatura HMAC SHA-256).</li>
                <li>• Idempotência por idempotency_key para evitar duplicações.</li>
                <li>• Registo de todos os eventos recebidos em webhooks_inbox com auditoria.</li>
                <li>• Resposta imediata ao GoHighLevel; erros de rede e limites tratados com retry.</li>
              </ul>
              {webhooks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Ainda não foram recebidos eventos.
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {webhooks.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <span className="font-medium">{w.event_type ?? "evento"}</span>
                      <span className="text-muted-foreground">
                        {new Date(w.created_at).toLocaleString("pt-PT")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="mapeamento" className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {["Pipelines", "Stages", "Utilizadores", "Calendários"].map((m) => (
                <section key={m} className="surface-card p-5">
                  <h3 className="text-base font-semibold">{m}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {conectada
                      ? "Faça o mapeamento por etapa no separador Jornada › Mapear Pipeline/Stage."
                      : "A lista é carregada do GoHighLevel após validação da ligação."}
                  </p>
                  <div className="mt-3 rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                    {conectada ? "Ligação validada" : "Sem dados — ligação por validar"}
                  </div>
                </section>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="guia" className="mt-4">
            <article className="surface-card space-y-4 p-6 text-sm">
              <h3 className="text-base font-semibold">Guia de conexão — checklist</h3>
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  No GoHighLevel, abra <strong>Settings › Private Integrations</strong> e crie uma integração com os
                  escopos mínimos: locations.readonly, contacts.readonly/write, opportunities.readonly/write,
                  calendars.readonly, users.readonly, conversations.readonly e conversations/message.write.
                </li>
                <li>Copie o token gerado e o Location ID da sub-conta da clínica.</li>
                <li>
                  Peça ao administrador para registar no backend os secrets <code>GHL_PRIVATE_TOKEN</code>,{" "}
                  <code>GHL_LOCATION_ID</code> e <code>GHL_WEBHOOK_SECRET</code> (e{" "}
                  <code>LOVABLE_API_KEY</code> para a IA). O estado aparece no separador Credenciais.
                </li>
                <li>Preencha o Pipeline ID e o Calendar ID e mapeie as etapas em Jornada › Mapear Pipeline/Stage.</li>
                <li>Copie a Callback URL do separador Webhooks e registe-a nos webhooks do GoHighLevel.</li>
                <li>Clique em «Testar conexão» e confirme o nome da conta devolvido.</li>
                <li>Execute a «Sincronização (leitura)» e verifique os contactos importados em Clientes.</li>
                <li>Só depois de validar os dados ative «Permitir escrita» para libertar envios e alterações.</li>
              </ol>
              <p className="text-muted-foreground">
                Nenhuma chave é escrita no código ou no navegador. Todas as chamadas passam por um proxy no backend com
                lista de operações permitidas, tempo limite e novas tentativas.
              </p>
            </article>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
