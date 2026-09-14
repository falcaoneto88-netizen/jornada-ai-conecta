import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Copy, Archive, RefreshCw, Wand2 } from "lucide-react";
import { useModoDados, usePermissoes } from "@/lib/repo";
import { useOrganizacao } from "@/lib/organization";
import {
  getMessageLibrary,
  getMessageTemplateContext,
  saveMessageTemplateDraft,
} from "@/lib/message-library.functions";
import { melhorarTexto } from "@/lib/ai.functions";
import {
  analisarVariaveis,
  canaisModelo,
  idiomasModelo,
  variaveisModelo,
  migrarVariaveisAntigas,
  previsualizarModelo,
  exemploModelo,
  preservarVariaveis,
  draftModeloSchema,
  type ModeloBiblioteca,
  type DraftModelo,
} from "@/lib/message-library.core";
import { formatarDataHora } from "@/lib/clinic-time";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
const vazio: DraftModelo = {
  name: "",
  body: "",
  channel: "whatsapp",
  language: "PT-BR",
  stage_key: null,
  usage_note: "",
  lifecycle: "draft",
};
type Edicao = { id: string; expectedRevision: number | null; draft: DraftModelo };
function editar(m: ModeloBiblioteca): Edicao {
  return {
    id: m.id,
    expectedRevision: m.revision,
    draft: {
      name: m.name,
      body: m.body,
      channel: m.channel,
      language: m.language,
      stage_key: m.stage_key,
      usage_note: m.usage_note,
      lifecycle: m.lifecycle,
    },
  };
}
export function MessageLibrary() {
  const { demo, escopo } = useModoDados();
  const org = useOrganizacao();
  if (demo)
    return (
      <p className="surface-card p-6">
        Entre na sua conta para criar e consultar a biblioteca da clínica. Nenhum dado DEMO será
        importado.
      </p>
    );
  if (org.isError) return <p role="alert">Não foi possível identificar a organização.</p>;
  if (!org.data) return <p>A carregar organização…</p>;
  return (
    <Biblioteca
      key={`${escopo}:${org.data.organizacao.id}`}
      org={org.data.organizacao.id}
      fuso={org.data.organizacao.timezone}
      escopo={escopo}
    />
  );
}
function Biblioteca({ org, fuso, escopo }: { org: string; fuso: string; escopo: string }) {
  const ler = useServerFn(getMessageLibrary);
  const pode = usePermissoes().gerirJornada;
  const [busca, setBusca] = useState("");
  const [canal, setCanal] = useState("todos");
  const [idioma, setIdioma] = useState("todos");
  const [etapa, setEtapa] = useState("todas");
  const [estado, setEstado] = useState("draft");
  const [selecionado, setSelecionado] = useState<Edicao | null>(null);
  const q = useQuery({
    queryKey: ["message-library", escopo, org],
    queryFn: () => ler({ data: { organizationId: org } }),
    retry: false,
  });
  if (q.isPending) return <p>A carregar modelos…</p>;
  if (q.isError)
    return (
      <div role="alert">
        <p>{q.error.message}</p>
        <Button onClick={() => void q.refetch()}>Tentar novamente</Button>
      </div>
    );
  const lista = q.data.modelos.filter(
    (m) =>
      (estado === "todos" || m.lifecycle === estado) &&
      (canal === "todos" || m.channel === canal) &&
      (idioma === "todos" || m.language === idioma) &&
      (etapa === "todas" || (m.stage_key ?? "geral") === etapa) &&
      `${m.name} ${m.body}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-semibold">Biblioteca da clínica</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rascunhos salvos somente no app. Revise antes de usar; salvar aqui não altera mensagens
            nem workflows no GHL.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
          {pode && (
            <Button
              onClick={() =>
                setSelecionado({
                  id: crypto.randomUUID(),
                  expectedRevision: null,
                  draft: { ...vazio },
                })
              }
            >
              <Plus className="size-4" />
              Novo modelo
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          aria-label="Pesquisar modelos"
          placeholder="Pesquisar nome ou texto…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select
          aria-label="Filtrar por canal"
          className="rounded-lg border bg-card p-2 text-sm"
          value={canal}
          onChange={(e) => setCanal(e.target.value)}
        >
          <option value="todos">Todos os canais</option>
          {Object.entries(canaisModelo).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por idioma"
          className="rounded-lg border bg-card p-2 text-sm"
          value={idioma}
          onChange={(e) => setIdioma(e.target.value)}
        >
          <option value="todos">Todos os idiomas</option>
          {idiomasModelo.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por etapa"
          className="rounded-lg border bg-card p-2 text-sm"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value)}
        >
          <option value="todas">Todas as etapas</option>
          <option value="geral">Geral</option>
          {q.data.etapas.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          className="rounded-lg border bg-card p-2 text-sm"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          <option value="draft">Rascunhos</option>
          <option value="archived">Arquivados</option>
          <option value="todos">Todos os estados</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">
        {lista.length} modelo(s) encontrado(s).{" "}
        {pode
          ? "Você pode criar, editar, duplicar e arquivar."
          : "Seu acesso à biblioteca é de leitura."}
      </p>
      {lista.length === 0 ? (
        <p className="surface-card p-6">
          Nenhum modelo para estes filtros.
          {q.data.modelos.length === 0 && pode ? " Use Novo modelo para começar." : ""}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((m) => (
            <article key={m.id} className="surface-card flex flex-col gap-3 p-5">
              <h3 className="font-semibold">{m.name}</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {m.lifecycle === "draft" ? "Rascunho" : "Arquivado"}
                </Badge>
                <Badge variant="secondary">{canaisModelo[m.channel] ?? m.channel}</Badge>
                <Badge variant="outline">{m.language}</Badge>
                <Badge variant="outline">
                  {q.data.etapas.find((s) => s.key === m.stage_key)?.name ?? m.stage_key ?? "Geral"}
                </Badge>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {m.body}
              </p>
              <p className="text-xs text-muted-foreground">
                Revisão {m.revision} · {formatarDataHora(m.updated_at, fuso)}
              </p>
              <div className="mt-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelecionado(editar(m))}>
                  {pode ? "Editar e pré-visualizar" : "Ver modelo"}
                </Button>
                {pode && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Duplicar ${m.name}`}
                    onClick={() =>
                      setSelecionado({
                        id: crypto.randomUUID(),
                        expectedRevision: null,
                        draft: {
                          ...editar(m).draft,
                          name: `${m.name.slice(0, 110)} — cópia`,
                          lifecycle: "draft",
                        },
                      })
                    }
                  >
                    <Copy className="size-4" />
                    Duplicar
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={!!selecionado}
        onOpenChange={(open) => {
          if (!open) setSelecionado(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {selecionado?.expectedRevision ? "Revisar modelo" : "Novo modelo"}
            </DialogTitle>
            <DialogDescription>
              Rascunho da biblioteca. Nenhuma mensagem será enviada por esta tela.
            </DialogDescription>
          </DialogHeader>
          {selecionado && (
            <Editor
              key={selecionado.id}
              inicial={selecionado}
              org={org}
              escopo={escopo}
              fuso={fuso}
              pode={pode}
              dados={q.data}
              fechar={() =>
                setSelecionado((atual) => (atual?.id === selecionado.id ? null : atual))
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Editor({
  inicial,
  org,
  escopo,
  fuso,
  pode,
  dados,
  fechar,
}: {
  inicial: Edicao;
  org: string;
  escopo: string;
  fuso: string;
  pode: boolean;
  dados: Awaited<ReturnType<typeof getMessageLibrary>>;
  fechar: () => void;
}) {
  const [draft, setDraft] = useState(inicial.draft);
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState("");
  const [consulta, setConsulta] = useState("");
  const [sugestao, setSugestao] = useState<{ original: string; texto: string } | null>(null);
  const [iaPending, setIaPending] = useState(false);
  const editVersion = useRef(0);
  const qc = useQueryClient();
  const salvar = useServerFn(saveMessageTemplateDraft);
  const contexto = useServerFn(getMessageTemplateContext);
  const ia = useServerFn(melhorarTexto);
  const q = useQuery({
    queryKey: ["template-preview", escopo, org, consulta],
    enabled: !!consulta,
    queryFn: () => contexto({ data: { organizationId: org, appointmentId: consulta } }),
    retry: false,
    staleTime: 0,
  });
  const v = analisarVariaveis(draft.body);
  const preview = previsualizarModelo(
    draft.body,
    consulta ? (q.isError || q.isPending || q.isFetching ? {} : q.data.values) : exemploModelo,
  );
  const valido =
    draftModeloSchema.safeParse(draft).success && !v.invalidas.length && !v.malformadas;
  function mudar<K extends keyof DraftModelo>(k: K, value: DraftModelo[K]) {
    editVersion.current++;
    setSugestao(null);
    setDraft((d) => ({ ...d, [k]: value }));
  }
  async function guardar(lifecycle = draft.lifecycle) {
    if (!pode || pending || !valido) return;
    setPending(true);
    setErro("");
    try {
      await salvar({
        data: {
          organizationId: org,
          id: inicial.id,
          expectedRevision: inicial.expectedRevision,
          draft: { ...draft, lifecycle },
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["message-library"] }),
        qc.invalidateQueries({ queryKey: ["modelos"] }),
      ]);
      toast.success(
        lifecycle === "archived"
          ? "Modelo arquivado. Pode restaurá-lo pelo filtro Arquivados."
          : "Rascunho salvo na biblioteca.",
      );
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar. Atualize antes de repetir.");
    } finally {
      setPending(false);
    }
  }
  async function melhorar() {
    const version = editVersion.current;
    const body = draft.body;
    setIaPending(true);
    setErro("");
    try {
      const r = await ia({ data: { texto: body } });
      if (editVersion.current !== version) return;
      if (!r.ok) throw new Error(r.message);
      if (!preservarVariaveis(body, r.texto))
        throw new Error(
          "A IA alterou variáveis. A sugestão foi recusada; seu texto foi preservado.",
        );
      setSugestao({ original: body, texto: r.texto });
    } catch (e) {
      if (editVersion.current === version) setErro(e instanceof Error ? e.message : "Falha na IA.");
    } finally {
      setIaPending(false);
    }
  }
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado. Revise o destinatário e o contexto antes de usar.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto manualmente.");
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <fieldset className="space-y-4" disabled={!pode || pending}>
          <label className="block space-y-1 text-sm">
            <span>Nome do modelo</span>
            <Input
              value={draft.name}
              maxLength={120}
              onChange={(e) => mudar("name", e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Canal planejado
              <select
                className="mt-1 w-full rounded-lg border bg-card p-2"
                value={draft.channel}
                onChange={(e) => mudar("channel", e.target.value as DraftModelo["channel"])}
              >
                {Object.entries(canaisModelo).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Idioma
              <select
                className="mt-1 w-full rounded-lg border bg-card p-2"
                value={draft.language}
                onChange={(e) => mudar("language", e.target.value as DraftModelo["language"])}
              >
                {idiomasModelo.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Etapa da jornada
            <select
              className="mt-1 w-full rounded-lg border bg-card p-2"
              value={draft.stage_key ?? ""}
              onChange={(e) => mudar("stage_key", e.target.value || null)}
            >
              <option value="">Geral — sem etapa</option>
              {dados.etapas.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Quando usar — nota interna</span>
            <Textarea
              value={draft.usage_note}
              rows={2}
              maxLength={1000}
              onChange={(e) => mudar("usage_note", e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Texto da mensagem</span>
            <Textarea
              value={draft.body}
              rows={9}
              maxLength={6000}
              onChange={(e) => mudar("body", e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {draft.body.length}/6000 caracteres. Idioma e canal organizam o modelo; não traduzem nem
            configuram um envio.
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(variaveisModelo).map(([k, label]) => (
              <button
                type="button"
                title={`{{${k}}}`}
                className="rounded-full border px-2 py-1 text-xs"
                key={k}
                onClick={() => mudar("body", draft.body + `{{${k}}}`)}
              >
                {label}
              </button>
            ))}
          </div>
          {v.invalidas.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              Variáveis não suportadas: {v.invalidas.join(", ")}
            </p>
          )}
          {v.malformadas && (
            <p role="alert" className="text-sm text-destructive">
              Há chaves ou variáveis incompletas no texto.
            </p>
          )}
          {migrarVariaveisAntigas(draft.body) !== draft.body && (
            <Button
              variant="outline"
              onClick={() => mudar("body", migrarVariaveisAntigas(draft.body))}
            >
              Substituir variáveis antigas de data, hora e clínica
            </Button>
          )}
        </fieldset>
        {pode && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={!valido || pending} onClick={() => void guardar()}>
              {pending ? "A salvar…" : "Salvar rascunho"}
            </Button>
            <Button
              variant="outline"
              disabled={iaPending || pending || !valido}
              onClick={() => void melhorar()}
            >
              <Wand2 className="size-4" />
              {iaPending ? "A sugerir…" : "Sugerir melhoria com IA"}
            </Button>
            {inicial.expectedRevision && (
              <Button
                variant="ghost"
                disabled={!valido || pending}
                onClick={() => void guardar(draft.lifecycle === "archived" ? "draft" : "archived")}
              >
                <Archive className="size-4" />
                {draft.lifecycle === "archived" ? "Restaurar rascunho" : "Arquivar"}
              </Button>
            )}
          </div>
        )}
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        {sugestao && (
          <section className="space-y-2 rounded-xl border p-4">
            <h3 className="font-semibold">Sugestão da IA — ainda não aplicada</h3>
            <p className="whitespace-pre-wrap text-sm">{sugestao.texto}</p>
            <Button disabled={pending} onClick={() => mudar("body", sugestao.texto)}>
              Usar sugestão revisada
            </Button>
            <Button variant="ghost" onClick={() => setSugestao(null)}>
              Descartar sugestão
            </Button>
          </section>
        )}
      </div>
      <aside className="space-y-4 rounded-xl border bg-secondary/20 p-4">
        <h3 className="font-semibold">Pré-visualização</h3>
        <label className="block text-sm">
          Dados para a prévia
          <select
            className="mt-1 w-full rounded-lg border bg-card p-2"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          >
            <option value="">Exemplo fictício — Ana Exemplo</option>
            {dados.consultas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title || "Consulta"} · {formatarDataHora(a.start_at, fuso)}
              </option>
            ))}
          </select>
        </label>
        {dados.consultasLimitadas && (
          <p className="text-xs">
            Lista limitada às 200 consultas mais recentes por data de início.
          </p>
        )}
        <Badge variant="outline">
          {consulta ? "Dados da consulta selecionada" : "EXEMPLO FICTÍCIO"}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {consulta
            ? `Prévia baseada na agenda e no cadastro sincronizados do app. Fuso: ${fuso}. Confira no GHL antes de usar; a formatação pode variar.`
            : "Nome, clínica e data abaixo são fictícios. Este exemplo não representa nenhum paciente."}
        </p>
        {consulta && (q.isPending || q.isFetching) ? (
          <p>A consultar dados…</p>
        ) : consulta && q.isError ? (
          <p role="alert">{q.error.message}</p>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 text-sm">
              {preview.texto || "Escreva a mensagem para visualizar."}
            </p>
            {preview.ausentes.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Dados ausentes: {preview.ausentes.join(", ")}. O texto preenchido não pode ser
                copiado.
              </p>
            )}
            {consulta && q.data && (
              <p className="text-xs">
                Cadastro da consulta: {q.data.status}.{" "}
                {q.data.passada ? "A data da consulta já passou. " : ""}Consultado em{" "}
                {formatarDataHora(q.data.consultadoEm, fuso)}.
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!valido}
            onClick={() => void copiar(draft.body)}
          >
            Copiar modelo com variáveis
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              !consulta || q.isError || q.isPending || q.isFetching || !preview.completo || !valido
            }
            onClick={() => void copiar(preview.texto)}
          >
            Copiar texto preenchido
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Rascunho para revisão. Campos de consulta precisam do contexto correto no workflow do GHL.
          A prévia não testa entrega de mensagens.
        </p>
      </aside>
    </div>
  );
}
