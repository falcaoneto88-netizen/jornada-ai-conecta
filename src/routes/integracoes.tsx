import { SyncPendencias } from "@/components/sync-pendencias";
import { BioreportSetup } from "@/components/bioreport-setup";
import type { PendenciaContacto } from "@/lib/ghl-contacts.core";
import { createFileRoute } from "@tanstack/react-router";

import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Lock, PlugZap, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  configurarPipelineGhl,
  listarPipelinesGhl,
  sincronizarOportunidadesGhl,
} from "@/lib/ghl-pipelines.functions";
import {
  configurarCalendarioGhl,
  listarCalendariosGhl,
  sincronizarAgendaGhl,
} from "@/lib/ghl-agenda.functions";
import { getGhlSecretsStatus, syncGhl, testGhlConnection } from "@/lib/ghl.functions";

import { useGuardarLigacaoGhl, useLigacaoGhl, useModoDados, usePermissoes, useWebhooks } from "@/lib/repo";

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

const CALLBACK_URL = "https://jornada-ai-conecta.lovable.app/api/public/ghl-webhook";

const ESTADO_WEBHOOK: Record<string, { rotulo: string; variante: "default" | "outline" | "destructive" }> = {
  processado: { rotulo: "Processado", variante: "default" },
  a_processar: { rotulo: "Em processamento", variante: "outline" },
  falhado: { rotulo: "Falhado", variante: "destructive" },
  recebido: { rotulo: "Recebido", variante: "outline" },
};

type EstadoSecrets = {
  configurada?: boolean;
  token: boolean;
  locationId: boolean;
  webhookSecret: boolean;
  ia: boolean;
};

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

type PipelineListado = { id: string; name: string; stages: { id: string; name: string; position: number }[] };

function MapeamentoPipelines({
  conectada,
  podeGerir,
  demo,
}: {
  conectada: boolean;
  podeGerir: boolean;
  demo: boolean;
}) {
  const listar = useServerFn(listarPipelinesGhl);
  const configurar = useServerFn(configurarPipelineGhl);
  const sincronizarOps = useServerFn(sincronizarOportunidadesGhl);
  const [pipelines, setPipelines] = useState<PipelineListado[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCarregar, setACarregar] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [aImportar, setAImportar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);
  const qc = useQueryClient();

  async function refrescarCaches(chaves: string[]) {
    await Promise.all(chaves.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  }

  async function carregar() {
    setACarregar(true);
    setErro(null);
    try {
      const res = await listar();
      if (!res.ok) {
        setErro(res.message);
        setPipelines([]);
        return;
      }
      setPipelines(res.pipelines);
      setSelecionado(res.selecionado ?? null);
    } catch {
      setErro("Não foi possível obter os funis da conta.");
    } finally {
      setACarregar(false);
    }
  }

  async function guardar(pipelineId: string) {
    setAGuardar(true);
    try {
      const res = await configurar({ data: { pipelineId } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setSelecionado(pipelineId);
      setOcorrencias([]);
      await refrescarCaches(["ligacao-ghl", "etapas", "etapas-pipeline", "oportunidades"]);
      toast.success(
        `Funil «${res.pipeline.name}» ligado: ${res.etapasAssociadas} etapa(s) associada(s), ${res.etapasCriadas} criada(s).`,
      );
    } catch {
      toast.error("Não foi possível guardar o funil.");
    } finally {
      setAGuardar(false);
    }
  }

  async function importar() {
    setAImportar(true);
    try {
      const res = await sincronizarOps();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.resultado;
      const resumo = `${r.inseridas} novas, ${r.atualizadas} atualizadas, ${r.contactosNovos} contacto(s) novo(s)`;
      setOcorrencias(r.conflitos);
      await refrescarCaches(["ligacao-ghl", "etapas", "etapas-pipeline", "oportunidades", "contactos"]);
      if (r.completo) toast.success(`Oportunidades sincronizadas: ${resumo}.`);
      else
        toast.warning(
          `Sincronização incompleta: ${resumo}${r.adiadas ? `, ${r.adiadas} adiada(s)` : ""}. ${r.conflitos.length} ocorrência(s).`,
        );
    } catch {
      toast.error("Não foi possível sincronizar as oportunidades.");
    } finally {
      setAImportar(false);
    }
  }

  if (demo || !podeGerir) {
    return (
      <div className="surface-card p-6 text-sm text-muted-foreground">
        Apenas administradores da conta podem ligar funis do GoHighLevel.
      </div>
    );
  }

  if (!conectada) {
    return (
      <div className="surface-card p-6 text-sm text-muted-foreground">
        Valide primeiro a ligação no separador Ligação para carregar os funis reais.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Funis e etapas do GoHighLevel</h3>
          <p className="text-sm text-muted-foreground">
            Escolha o funil a acompanhar. As etapas são criadas ou associadas apenas por nome exatamente igual.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void carregar()} disabled={aCarregar}>
            <RefreshCw className="size-4" /> {aCarregar ? "A carregar…" : "Carregar funis"}
          </Button>
          <Button onClick={() => void importar()} disabled={!selecionado || aImportar}>
            {aImportar ? "A sincronizar…" : "Sincronizar oportunidades"}
          </Button>
        </div>
      </div>

      {erro && <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{erro}</p>}

      {ocorrencias.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h4 className="text-sm font-semibold">Ocorrências da última sincronização ({ocorrencias.length})</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {ocorrencias.slice(0, 12).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          {ocorrencias.length > 12 && (
            <p className="mt-2 text-xs text-muted-foreground">e mais {ocorrencias.length - 12} ocorrência(s).</p>
          )}
        </section>
      )}

      {pipelines === null && !erro && (
        <div className="surface-card p-6 text-sm text-muted-foreground">
          Clique em «Carregar funis» para ler os funis reais da conta ligada.
        </div>
      )}

      {pipelines?.length === 0 && !erro && (
        <div className="surface-card p-6 text-sm text-muted-foreground">Nenhum funil encontrado nesta conta.</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(pipelines ?? []).map((p) => (
          <section key={p.id} className="surface-card space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold break-words">{p.name}</h4>
                <p className="text-xs text-muted-foreground">{p.stages.length} etapa(s)</p>
              </div>
              {selecionado === p.id ? (
                <Badge>Ligado</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void guardar(p.id)} disabled={aGuardar}>
                  Ligar
                </Button>
              )}
            </div>
            <ol className="space-y-1 text-xs text-muted-foreground">
              {[...p.stages]
                .sort((a, b) => a.position - b.position)
                .map((s, i) => (
                  <li key={s.id}>
                    {i + 1}. {s.name}
                  </li>
                ))}
            </ol>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        A ligação está em modo leitura: nada é criado nem movido no GoHighLevel.
      </p>
    </div>
  );
}

type CalendarioListado = { id: string; name: string; ativo: boolean };

function MapeamentoCalendarios({
  conectada,
  podeGerir,
  demo,
}: {
  conectada: boolean;
  podeGerir: boolean;
  demo: boolean;
}) {
  const listar = useServerFn(listarCalendariosGhl);
  const configurar = useServerFn(configurarCalendarioGhl);
  const sincronizarAgendaFn = useServerFn(sincronizarAgendaGhl);
  const [calendarios, setCalendarios] = useState<CalendarioListado[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCarregar, setACarregar] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [aImportar, setAImportar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);
  const qc = useQueryClient();

  async function refrescar(chaves: string[]) {
    await Promise.all(chaves.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  }

  async function carregar() {
    setACarregar(true);
    setErro(null);
    try {
      const res = await listar();
      if (!res.ok) {
        setErro(res.message);
        setCalendarios([]);
        return;
      }
      setCalendarios(res.calendarios);
      setSelecionado(res.selecionado ?? null);
    } catch {
      setErro("Não foi possível obter as agendas da conta.");
    } finally {
      setACarregar(false);
    }
  }

  async function ligar(calendarId: string) {
    setAGuardar(true);
    try {
      const res = await configurar({ data: { calendarId } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setSelecionado(calendarId);
      await refrescar(["ligacao-ghl", "marcacoes"]);
      toast.success(`Agenda «${res.calendario.name}» ligada.`);
    } catch {
      toast.error("Não foi possível ligar a agenda.");
    } finally {
      setAGuardar(false);
    }
  }

  async function importar() {
    setAImportar(true);
    try {
      const res = await sincronizarAgendaFn();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.resultado;
      setOcorrencias(r.conflitos);
      await refrescar(["ligacao-ghl", "marcacoes", "contactos"]);
      const resumo = `${r.inseridas} nova(s), ${r.atualizadas} atualizada(s), ${r.contactosNovos} cliente(s) novo(s)`;
      if (r.completo) toast.success(`Marcações sincronizadas: ${resumo}.`);
      else toast.warning(`Sincronização com ${r.conflitos.length} ocorrência(s): ${resumo}.`);
    } catch {
      toast.error("Não foi possível sincronizar as marcações.");
    } finally {
      setAImportar(false);
    }
  }

  if (demo || !podeGerir) {
    return (
      <div className="surface-card p-6 text-sm text-muted-foreground">
        Apenas administradores da conta podem ligar agendas do GoHighLevel.
      </div>
    );
  }

  if (!conectada) {
    return (
      <div className="surface-card p-6 text-sm text-muted-foreground">
        Valide primeiro a ligação no separador Ligação para carregar as agendas reais.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Agenda do GoHighLevel</h3>
          <p className="text-sm text-muted-foreground">
            Escolha a agenda a acompanhar. As marcações aparecem depois na secção Agenda, em leitura.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void carregar()} disabled={aCarregar}>
            <RefreshCw className="size-4" /> {aCarregar ? "A carregar…" : "Carregar agendas"}
          </Button>
          <Button onClick={() => void importar()} disabled={!selecionado || aImportar}>
            {aImportar ? "A sincronizar…" : "Sincronizar marcações"}
          </Button>
        </div>
      </div>

      {erro && <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{erro}</p>}

      {ocorrencias.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h4 className="text-sm font-semibold">Ocorrências da última sincronização ({ocorrencias.length})</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {ocorrencias.slice(0, 12).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {calendarios === null && !erro && (
        <div className="surface-card p-6 text-sm text-muted-foreground">
          Clique em «Carregar agendas» para ler as agendas reais da conta ligada.
        </div>
      )}

      {calendarios?.length === 0 && !erro && (
        <div className="surface-card p-6 text-sm text-muted-foreground">Nenhuma agenda encontrada nesta conta.</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(calendarios ?? []).map((c) => (
          <section key={c.id} className="surface-card flex items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold break-words">{c.name}</h4>
              <p className="font-mono text-xs break-all text-muted-foreground">{c.id}</p>
              {!c.ativo && <p className="text-xs text-muted-foreground">Agenda inativa no GoHighLevel.</p>}
            </div>
            {selecionado === c.id ? (
              <Badge>Ligada</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void ligar(c.id)} disabled={aGuardar}>
                Ligar
              </Button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Integracoes() {
  const qc = useQueryClient();

  const { demo, escopo } = useModoDados();
  const [pendenciasSync, setPendenciasSync] = useState<{ escopo: string; items: PendenciaContacto[] } | null>(null);

  const permissoes = usePermissoes();
  const podeGerir = permissoes.gerirIntegracao;
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
    setPendenciasSync(null);
    setASincronizar(true);
    try {
      const res = await sincronizar();
      setPendenciasSync({ escopo, items: "pendencias" in res ? res.pendencias : [] });
      if (res.ok) toast.success(`Sincronização em leitura concluída: ${res.importados} gravados, ${res.ignorados} já atualizados.`);
      else toast.error(res.message);
    } catch {
      toast.error("Conclusão não confirmada. Alguns contactos podem ter sido importados; os dados serão atualizados.");
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["contactos"] }),
        qc.invalidateQueries({ queryKey: ["ligacao-ghl"] }),
      ]);
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
        // Campo vazio não apaga o funil ligado em Mapeamento.
        default_pipeline_id: pipeline.trim() ? pipeline.trim() : (ligacao?.default_pipeline_id ?? null),
        // Campo vazio não apaga a agenda ligada em Mapeamento.
        calendar_id: calendario.trim() ? calendario.trim() : (ligacao?.calendar_id ?? null),
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
        <SyncPendencias pendencias={pendenciasSync?.escopo === escopo ? pendenciasSync.items : []} />
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
                    ? `Ligação validada${ligacao?.last_test_at ? ` em ${new Date(ligacao.last_test_at).toLocaleString("pt-PT")}` : ""}.`
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

          <TabsContent value="credenciais" className="mt-4 space-y-4">
            <BioreportSetup allowed={!demo && podeGerir} />
            <div className="surface-card space-y-5 p-6">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                O token privado, o Location ID e o segredo do webhook vivem apenas como secrets do backend. Não existem
                campos para os escrever aqui: o administrador regista-os em Definições do projeto › Secrets.
              </p>

              {demo && (
                <p className="text-sm text-muted-foreground">
                  O estado real das credenciais só é visível com conta iniciada.
                </p>
              )}

              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" hidden={demo}>
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
                  <Label htmlFor="base-url">Endereço da API (fixo)</Label>
                  <Input id="base-url" value={baseUrl} readOnly disabled className="mt-1.5 bg-card" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Definido no servidor e não editável, para o token nunca poder ser enviado a outro destino.
                  </p>
                </div>
                <div>
                  <Label htmlFor="versao">Versão da API (fixa)</Label>
                  <Input id="versao" value={versao} readOnly disabled className="mt-1.5 bg-card" />
                </div>
                <div>
                  <Label htmlFor="pipeline">Pipeline ID padrão</Label>
                  <Input
                    id="pipeline"
                    value={pipeline}
                    onChange={(e) => setPipeline(e.target.value)}
                    placeholder="ex.: pipe_98765"
                    disabled={demo || !podeGerir}
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
                    disabled={demo || !podeGerir}
                    className="mt-1.5 bg-card"
                  />
                </div>
              </div>

              {!demo && !podeGerir && (
                <p className="text-sm text-muted-foreground">
                  Só o administrador da conta pode alterar, testar ou sincronizar esta ligação.
                </p>
              )}

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
                  disabled={demo || !conectada || !podeGerir}
                  aria-label="Permitir escrita no GoHighLevel"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void testarLigacao()} disabled={aTestar || demo || !podeGerir}>
                  <ShieldCheck className="size-4" /> {aTestar ? "A testar…" : "Testar conexão"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void sincronizarAgora()}
                  disabled={aSincronizar || demo || !podeGerir}
                >
                  <RefreshCw className="size-4" /> {aSincronizar ? "A sincronizar…" : "Sincronização (leitura)"}
                </Button>
                <Button variant="outline" onClick={guardarConfig} disabled={demo || guardar.isPending || !podeGerir}>
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
                <li>
                  • Autenticação por cabeçalho: <code>x-webhook-secret</code> com o valor de{" "}
                  <code>GHL_WEBHOOK_SECRET</code> (caminho «Custom Webhook» dos workflows do GoHighLevel).
                </li>
                <li>
                  • Eventos suportados: <code>contact.created</code> e <code>contact.updated</code>. Outros eventos são
                  recusados em vez de marcados como processados.
                </li>
                <li>
                  • Cada evento é confirmado na API oficial do GoHighLevel antes de gravar; entregas repetidas não
                  duplicam clientes nem registos.
                </li>
                <li>
                  • Só sincroniza a ficha do cliente. Não executa automações da jornada nem move oportunidades.
                </li>
              </ul>
              {webhooks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Ainda não foram recebidos eventos.
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {webhooks.map((w) => {
                    const estado = ESTADO_WEBHOOK[w.status ?? "recebido"] ?? ESTADO_WEBHOOK["recebido"]!;
                    return (
                      <li key={w.id} className="space-y-1 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{w.event_type ?? "evento"}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={estado.variante}>{estado.rotulo}</Badge>
                            <span className="text-muted-foreground">
                              {new Date(w.created_at).toLocaleString("pt-PT")}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Tentativas: {w.attempts ?? 0}
                          {w.processed_at
                            ? ` · processado em ${new Date(w.processed_at).toLocaleString("pt-PT")}`
                            : ""}
                        </p>
                        {w.error_message && (
                          <p className="text-xs break-words text-destructive">Falha: {w.error_message}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="mapeamento" className="mt-4">
            <div className="space-y-8">
              <MapeamentoPipelines conectada={conectada} podeGerir={podeGerir} demo={demo} />
              <MapeamentoCalendarios conectada={conectada} podeGerir={podeGerir} demo={demo} />
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
                <li>Clique em «Testar conexão» e confirme o nome da conta devolvido.</li>
                <li>Execute a «Sincronização (leitura)» e verifique os contactos importados em Clientes.</li>
                <li>Só depois de validar os dados ative «Permitir escrita» para libertar envios e alterações.</li>
              </ol>

              <h3 className="text-base font-semibold">Receber contactos em tempo real (Custom Webhook)</h3>
              <p className="text-muted-foreground">
                O endereço de callback só responde depois de a versão atual da aplicação estar publicada. Enquanto não
                publicar, use este guia apenas para preparar os workflows.
              </p>
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  No GoHighLevel, abra <strong>Automation › Workflows</strong> e crie um workflow com o gatilho{" "}
                  <em>Contact Created</em>. Deixe-o em <em>Draft</em> por agora.
                </li>
                <li>
                  Adicione a ação chamada <strong>Custom Webhook</strong> e configure: <em>Event</em> ={" "}
                  <code>CUSTOM</code>, <em>Method</em> = <code>POST</code>, <em>Authorization</em> = <code>None</code>,
                  e cole o endereço de callback do separador Webhooks.
                </li>
                <li>
                  Em <em>Headers</em>, adicione <code>Content-Type: application/json</code> e{" "}
                  <code>x-webhook-secret</code> com exatamente o mesmo valor guardado em{" "}
                  <code>GHL_WEBHOOK_SECRET</code>. A autenticação é feita só por este cabeçalho.
                </li>
                <li>
                  Escolha <em>Raw Body</em> (JSON) e envie:
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary/40 p-3 text-xs">
{`{
  "type": "contact.created",
  "locationId": "ok2UHC2QMZsd8UHsAgEa",
  "contactId": "{{contact.id}}"
}`}
                  </pre>
                </li>
                <li>
                  Ainda em <em>Draft</em>, crie um contacto de teste dedicado e use <em>Test Workflow</em> com esse
                  contacto. Para o gatilho «Contact Created» não basta editar um contacto existente: tem mesmo de criar
                  um novo.
                </li>
                <li>
                  Volte a este separador Webhooks e confirme o estado <strong>Processado</strong>; depois confirme a
                  ficha real do contacto de teste em Clientes. Só depois de ambos estarem corretos deve publicar
                  (<em>Publish</em>) o workflow.
                </li>
                <li>
                  <strong>Opcional:</strong> repita com um segundo workflow de atualizações, usando o gatilho de
                  alteração de contacto disponível na sua conta (por exemplo <em>Contact Changed</em>, limitado aos
                  campos que quer sincronizar) e trocando o tipo para <code>contact.updated</code>. Só estes dois tipos
                  são aceites; os restantes são recusados.
                </li>
              </ol>
              <p className="text-muted-foreground">
                O recetor confirma sempre o contacto na API oficial do GoHighLevel antes de gravar, mantém a etapa de
                jornada dos clientes já existentes e não executa automações nem envia mensagens.
              </p>

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
