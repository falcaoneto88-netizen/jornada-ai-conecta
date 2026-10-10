import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, RefreshCw, Send, Sparkles, SpellCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConversasGhl, useMensagensGhl } from "@/lib/ghl-observation";
import { canalMensagem, respostaLiteral, type ConversaGhl } from "@/lib/ghl-observation.core";
import { useOrganizacao } from "@/lib/organization";
import { useModoDados } from "@/lib/repo";
import { formatarDataHora } from "@/lib/clinic-time";
import { aiSupport, type AnaliseIA } from "@/lib/ai.functions";
import { corrigirRascunho } from "@/lib/correcao-texto.functions";
import {
  getInboxSendContext,
  getInboxSendStatus,
  reconcileManualAgentMessage,
  sendInboxMessage,
} from "@/lib/commercial-agent.functions";
import { JevPedido } from "@/components/jev-pedido";
import { JevMensagem } from "@/components/jev-mensagem";

type EstadoEnvio =
  | { estado: "livre" }
  | { estado: "a_enviar" }
  | { estado: "aceite"; messageId: string }
  | { estado: "incerto"; requestId: string | null; manualId: string | null };
type Revisao = {
  historyHash: string;
  sessionVersion: number;
  providerId: string;
  defaultId: string | null;
};
type DestinoEnvio = {
  name: string;
  channel: string | null;
  transport: string | null;
  sendAllowed: boolean;
  blockedReason: string | null;
  revision: Omit<Revisao, "providerId"> & { providerId: string | null };
};
const LIMITE = 1500;
const mesmaRevisao = (a: Revisao, b: DestinoEnvio["revision"]) =>
  a.historyHash === b.historyHash &&
  a.sessionVersion === b.sessionVersion &&
  a.providerId === b.providerId &&
  a.defaultId === b.defaultId;
/** Envios incertos sobrevivem à troca de conversa (o servidor guarda o estado durável). */
const pendentes = new Map<string, Extract<EstadoEnvio, { estado: "incerto" }>>();
/** Códigos que comprovadamente acontecem antes de qualquer POST ao GHL. */
const ANTES_DO_ENVIO = new Set([
  "revision_changed",
  "route_changed",
  "route_unverified",
  "route_ambiguous",
  "draft_stale",
  "version_conflict",
  "do_not_contact",
  "unsupported_channel",
  "channel_window",
  "send_disabled",
  "forbidden",
  "scope_mismatch",
  "inbound_not_verified",
  "history_invalid",
  "history_incomplete",
  "history_conflict",
  "manual_request_mismatch",
  "not_configured",
  "manual_not_configured",
  "encryption_not_configured",
]);

const ERROS_ENVIO: Record<string, string> = {
  send_disabled: "O envio por esta tela ainda não está liberado nesta clínica.",
  forbidden: "A sua conta não tem permissão para enviar nesta clínica.",
  scope_mismatch:
    "Esta conversa ainda não foi recebida pelo atendimento do Jornada AI; continue no GHL.",
  not_configured: "O envio manual não está configurado nesta clínica.",
  manual_not_configured: "O envio manual não está configurado nesta clínica.",
  encryption_not_configured: "O envio manual não está configurado nesta clínica.",
  do_not_contact: "Contato com DND ativo ou pedido de interrupção. Envio bloqueado.",
  unsupported_channel: "Canal sem envio homologado por esta tela. Continue no GHL.",
  channel_window: "A janela de resposta deste canal terminou. Continue no GHL.",
  inbound_not_verified: "Não há mensagem recebida válida para responder.",
  draft_stale: "A conversa mudou. Atualize as mensagens; o texto foi mantido.",
  version_conflict: "A conversa mudou. Atualize as mensagens; o texto foi mantido.",
  history_invalid: "Histórico do GHL inválido. Envio bloqueado.",
  history_incomplete: "Histórico do GHL incompleto. Envio bloqueado.",
  history_conflict: "Histórico do GHL inconsistente. Envio bloqueado.",
  reconciliation_required:
    "Existe um envio sem confirmação nesta conversa. Confira no GHL antes de enviar outra.",
  send_unknown: "Resultado do envio não confirmado. Não repita: confira no GHL.",
  manual_request_used: "Este envio já foi processado. Confira a conversa no GHL.",
  manual_request_mismatch: "Pedido de envio inconsistente. Atualize a página.",
  dispatch_blocked: "Envio bloqueado pelas regras de segurança. Confira no GHL.",
  receipt_not_verified: "O ID indicado não corresponde a este envio.",
  storage_unavailable: "Serviço temporariamente indisponível. O texto foi mantido.",
  route_unverified:
    "Não foi possível comprovar o fornecedor real de envio desta conversa. Envio bloqueado.",
  route_ambiguous:
    "O fornecedor de envio é ambíguo (difere do padrão da subconta). Envio bloqueado.",
  route_changed: "A rota de envio mudou desde a revisão. Nada foi enviado.",
  revision_changed: "A conversa mudou desde a revisão. Nada foi enviado.",
};
const erroEnvio = (code: string) =>
  ERROS_ENVIO[code] ?? "Não foi possível enviar. O texto foi mantido.";

export function GhlInbox() {
  const contexto = useOrganizacao();
  const { escopo } = useModoDados();
  if (contexto.isError)
    return <p role="alert">Não foi possível identificar a clínica. Atualize a página.</p>;
  if (!contexto.data) return <p>A carregar a clínica…</p>;
  return (
    <CaixaGhl
      key={`${escopo}:${contexto.data.organizacao.id}`}
      fuso={contexto.data.organizacao.timezone}
    />
  );
}

function CaixaGhl({ fuso }: { fuso: string }) {
  const [pesquisa, setPesquisa] = useState("");
  const [query, setQuery] = useState("");
  const [ativa, setAtiva] = useState<string | null>(null);
  const result = useConversasGhl(query);
  const paginas = result.data?.pages ?? [];
  const conversas = Array.from(
    new Map(paginas.flatMap((p) => p.conversas).map((c) => [c.id, c])).values(),
  );
  const selecionada =
    conversas.find((c) => c.id === ativa) ?? (ativa === null ? conversas[0] : undefined);
  return (
    <div className="space-y-4">
      <div className="surface-card space-y-2 p-5">
        <h2 className="font-semibold">Conversas do GoHighLevel</h2>
        <p className="text-sm text-muted-foreground">
          Consulta direta à subconta da clínica, atualizada a cada 30 segundos enquanto esta página
          está visível. Horários: {fuso}.
        </p>
        <p className="text-sm text-muted-foreground">
          Abrir uma conversa aqui não a marca como lida no GHL. Resposta recebida, leitura e estado
          do agendamento são informações diferentes.
        </p>
        {paginas[0] && !result.isError && (
          <p className="text-xs text-muted-foreground">
            Última consulta: {formatarDataHora(paginas[0].consultadoEm, fuso)}
          </p>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[330px_1fr]">
        <section className="surface-card self-start overflow-hidden" aria-label="Conversas reais">
          <form
            className="flex gap-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(pesquisa.trim());
              setAtiva(null);
            }}
          >
            <Input
              aria-label="Pesquisar conversas no GHL"
              placeholder="Nome ou telefone"
              maxLength={100}
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>
          <div className="flex items-center justify-between px-4 pb-3">
            <span className="text-xs text-muted-foreground">
              {conversas.length} conversas carregadas
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={result.isFetching}
              onClick={() => void result.refetch()}
              aria-label="Atualizar conversas"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {result.isError ? (
            <ErroLeitura erro={result.error} repetir={() => void result.refetch()} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {conversas.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`w-full p-4 text-left hover:bg-secondary/60 ${selecionada?.id === c.id ? "bg-secondary" : ""}`}
                      onClick={() => setAtiva(c.id)}
                      aria-pressed={selecionada?.id === c.id}
                    >
                      <p className="font-medium">{c.nome}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {c.ultimaMensagem || "Sem prévia textual"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{canalMensagem(c.tipo)}</Badge>
                        {c.naoLidas !== null && c.naoLidas > 0 && (
                          <Badge>{c.naoLidas} por ler no GHL</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {c.ultimaData ? formatarDataHora(c.ultimaData, fuso) : "Data não informada"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {conversas.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">
                  {result.isPending
                    ? "A consultar o GHL…"
                    : "Nenhuma conversa encontrada no GHL para esta pesquisa."}
                </p>
              )}
              {result.hasNextPage && (
                <Button
                  className="m-4"
                  variant="outline"
                  disabled={result.isFetching}
                  onClick={() => void result.fetchNextPage()}
                >
                  Carregar mais conversas
                </Button>
              )}
              {paginas.some((p) => p.limitePaginacao) && (
                <p className="p-4 text-sm">
                  O GHL não forneceu um cursor que permita continuar. Refine a pesquisa ou consulte
                  o GHL para o histórico completo.
                </p>
              )}
            </>
          )}
        </section>
        {!result.isError && selecionada ? (
          <ConversaReal
            key={`${selecionada.id}:${selecionada.contactId}`}
            conversa={selecionada}
            fuso={fuso}
          />
        ) : (
          <p className="surface-card p-8 text-sm text-muted-foreground">
            Selecione uma conversa disponível para ler as mensagens.
          </p>
        )}
      </div>
    </div>
  );
}

export function ErroLeitura({ erro, repetir }: { erro: unknown; repetir: () => void }) {
  return (
    <div role="alert" className="space-y-3 p-5">
      <p className="text-sm text-destructive">
        {erro instanceof Error ? erro.message : "Não foi possível consultar o GHL."}
      </p>
      <p className="text-xs text-muted-foreground">
        Uma falha de acesso não significa que não existam registos.
      </p>
      <Button variant="outline" size="sm" onClick={repetir}>
        Tentar novamente
      </Button>
    </div>
  );
}

function ConversaReal({ conversa, fuso }: { conversa: ConversaGhl; fuso: string }) {
  const result = useMensagensGhl(conversa.id);
  const paginas = result.data?.pages ?? [];
  const mensagens = Array.from(
    new Map(paginas.flatMap((p) => p.mensagens).map((m) => [m.id, m])).values(),
  ).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
  const [rascunho, setRascunho] = useState("");
  const [analise, setAnalise] = useState<AnaliseIA | null>(null);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [analisadoAte, setAnalisadoAte] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [envio, setEnvio] = useState<EstadoEnvio>({ estado: "livre" });
  const [recibo, setRecibo] = useState("");
  const [destino, setDestino] = useState<DestinoEnvio | null>(null);
  const [erroDestino, setErroDestino] = useState<string | null>(null);
  const [referencia, setReferencia] = useState<Revisao | null>(null);
  const [tick, setTick] = useState(0);
  const [conferindo, setConferindo] = useState(false);
  const revisao = useRef(0);
  const pedido = useRef<{ rev: number; id: string } | null>(null);
  const orgId = useOrganizacao().data?.organizacao.id ?? null;
  const chavePendente = `${orgId}:${conversa.contactId}:${conversa.id}`;
  // Estado síncrono do envio: bloqueia entradas e duplo clique antes do re-render.
  const envioRef = useRef<EstadoEnvio>(envio);
  function mudarEnvio(e: EstadoEnvio) {
    envioRef.current = e;
    setEnvio(e);
    if (e.estado === "incerto") pendentes.set(chavePendente, e);
    else if (e.estado !== "a_enviar") pendentes.delete(chavePendente);
  }
  const analisar = useServerFn(aiSupport);
  const corrigirFn = useServerFn(corrigirRascunho);
  const enviarFn = useServerFn(sendInboxMessage);
  const contextoFn = useServerFn(getInboxSendContext);
  const estadoFn = useServerFn(getInboxSendStatus);
  const conferirFn = useServerFn(reconcileManualAgentMessage);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    // Trocar de conversa e voltar não contorna um envio incerto.
    const p = pendentes.get(chavePendente);
    if (p) mudarEnvio(p);
    return () => {
      vivo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ultimaId = mensagens.at(-1)?.id ?? null;
  // Capacidade atualizada a cada nova mensagem/atualização; a referência revista não muda sozinha.
  useEffect(() => {
    if (!orgId) return;
    let ativo = true;
    contextoFn({
      data: { organizationId: orgId, contactId: conversa.contactId, conversationId: conversa.id },
    })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) {
          setDestino(r.data);
          setErroDestino(r.data.blockedReason ? erroEnvio(r.data.blockedReason) : null);
          if (r.data.sendAllowed && r.data.revision.providerId)
            setReferencia((atual) => atual ?? (r.data.revision as Revisao));
          const ultimo = r.data.lastDispatch;
          if (
            ultimo &&
            ["unknown", "sending"].includes(ultimo.state) &&
            envioRef.current.estado !== "a_enviar"
          )
            mudarEnvio({
              estado: "incerto",
              requestId: envioRef.current.estado === "incerto" ? envioRef.current.requestId : null,
              manualId: ultimo.id,
            });
        } else {
          setDestino(null);
          setErroDestino(erroEnvio(r.code));
        }
      })
      .catch((e) => {
        console.log("CTXERR", e);
        if (!ativo) return;
        setDestino(null);
        setErroDestino("Não foi possível verificar o canal de envio desta conversa.");
      });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, conversa.id, conversa.contactId, ultimaId, tick]);
  const revisaoMudou = Boolean(
    referencia && destino && !mesmaRevisao(referencia, destino.revision),
  );
  // Remontado por conversationId/contactId: uma promessa antiga não altera o novo atendimento.
  async function gerarAnalise() {
    if (pendente || result.isError || mensagens.length === 0) return;
    setPendente(true);
    setErroIA(null);
    const ultima = mensagens.at(-1)?.id ?? null;
    try {
      const texto = mensagens
        .map((m) => `${m.direcao}: ${m.texto}`)
        .join("\n")
        .slice(-12000);
      const resposta = await analisar({ data: { conversa: texto, contexto: conversa.nome } });
      if (!vivo.current) return;
      if (resposta.ok) {
        setAnalise(resposta.analise);
        setAnalisadoAte(ultima);
      } else setErroIA(resposta.message);
    } catch {
      if (vivo.current) setErroIA("Não foi possível consultar a IA.");
    } finally {
      if (vivo.current) setPendente(false);
    }
  }
  // Cada alteração do campo (digitação, sugestão, Jev, correção) gera nova revisão.
  // Durante o envio todas as entradas são recusadas no próprio handler.
  function editar(texto: string) {
    if (envioRef.current.estado === "a_enviar") return;
    revisao.current += 1;
    setRascunho(texto);
    setAviso(null);
    if (envioRef.current.estado === "aceite") mudarEnvio({ estado: "livre" });
  }
  async function corrigir() {
    const texto = rascunho;
    if (!texto.trim() || corrigindo || envioRef.current.estado === "a_enviar") return;
    if (texto.length > LIMITE) {
      setAviso(`A correção aceita até ${LIMITE} caracteres. O texto foi mantido.`);
      return;
    }
    const rev = revisao.current;
    setCorrigindo(true);
    setAviso(null);
    try {
      const r = await corrigirFn({ data: { texto } });
      if (!vivo.current) return;
      if (revisao.current !== rev || (envioRef.current as EstadoEnvio).estado === "a_enviar") {
        setAviso("O texto foi alterado durante a correção; a sugestão foi descartada.");
        return;
      }
      if (r.ok) {
        if (r.texto === texto) setAviso("Nenhuma correção necessária.");
        else {
          editar(r.texto);
          setAviso("Correção aplicada. Reveja e edite livremente antes de enviar.");
        }
      } else setAviso(r.message);
    } catch {
      if (vivo.current) setAviso("Não foi possível corrigir agora. O texto foi mantido.");
    } finally {
      if (vivo.current) setCorrigindo(false);
    }
  }
  async function enviar() {
    const atual = envioRef.current.estado;
    if (atual === "a_enviar" || atual === "incerto" || !orgId) return;
    if (!referencia || !destino?.sendAllowed || revisaoMudou) return;
    const texto = rascunho.trim();
    if (!texto || texto.length > LIMITE) return;
    if (texto !== rascunho) editar(texto);
    // A mesma revisão reutiliza a mesma chave: repetições não geram segundo POST.
    if (!pedido.current || pedido.current.rev !== revisao.current)
      pedido.current = { rev: revisao.current, id: crypto.randomUUID() };
    const requestId = pedido.current.id;
    const rev = revisao.current;
    mudarEnvio({ estado: "a_enviar" });
    setAviso(null);
    try {
      const r = await enviarFn({
        data: {
          organizationId: orgId,
          contactId: conversa.contactId,
          conversationId: conversa.id,
          text: texto,
          requestId,
          revision: referencia,
        },
      });
      if (!vivo.current) return;
      if (!r.ok) {
        if (ANTES_DO_ENVIO.has(r.code)) mudarEnvio({ estado: "livre" });
        else mudarEnvio({ estado: "incerto", requestId, manualId: null });
        setAviso(
          r.code === "revision_changed" || r.code === "route_changed"
            ? "A conversa ou a rota mudou desde a sua revisão. Confira as mensagens e tente de novo; nada foi enviado."
            : erroEnvio(r.code),
        );
        return;
      }
      aplicarEstado(r.data.state, r.data.messageId, r.data.manualId, requestId, rev);
    } catch {
      if (vivo.current) mudarEnvio({ estado: "incerto", requestId, manualId: null });
    }
  }
  function aplicarEstado(
    state: string,
    messageId: string | null,
    manualId: string,
    requestId: string | null,
    rev: number | null,
  ) {
    if (state === "sent" && messageId) {
      mudarEnvio({ estado: "aceite", messageId });
      pedido.current = null;
      // Só limpa se ninguém editou depois da captura.
      if (rev !== null && revisao.current === rev) {
        revisao.current += 1;
        setRascunho("");
      }
      setReferencia(null);
      setTick((t) => t + 1);
      void result.refetch();
    } else if (state === "rejected" || state === "prepared" || state === "invalidated") {
      mudarEnvio({ estado: "livre" });
      if (state === "rejected")
        setAviso("O envio foi recusado. O texto foi mantido; confira a conversa.");
    } else mudarEnvio({ estado: "incerto", requestId, manualId });
  }
  async function verificarEstado() {
    const e = envioRef.current;
    if (e.estado !== "incerto" || !orgId || conferindo) return;
    setConferindo(true);
    try {
      if (!e.requestId) {
        setTick((t) => t + 1);
        return;
      }
      const r = await estadoFn({ data: { organizationId: orgId, requestId: e.requestId } });
      if (!vivo.current) return;
      if (!r.ok) setAviso(erroEnvio(r.code));
      else if (r.data === null) {
        mudarEnvio({ estado: "livre" });
        setAviso("O servidor não registou esse envio. Nada foi enviado; pode tentar de novo.");
      } else aplicarEstado(r.data.state, r.data.messageId, r.data.manualId, e.requestId, null);
    } catch {
      if (vivo.current) setAviso("Não foi possível verificar agora. O envio continua bloqueado.");
    } finally {
      if (vivo.current) setConferindo(false);
    }
  }
  async function conferir() {
    const e = envioRef.current;
    if (e.estado !== "incerto" || !e.manualId || !orgId || conferindo) return;
    setConferindo(true);
    try {
      const r = await conferirFn({
        data: { organizationId: orgId, manualId: e.manualId, messageId: recibo.trim() },
      });
      if (!vivo.current) return;
      if (r.ok) {
        mudarEnvio({ estado: "aceite", messageId: recibo.trim() });
        setRecibo("");
        setTick((t) => t + 1);
        void result.refetch();
      } else setAviso(erroEnvio(r.code));
    } catch {
      if (vivo.current) setAviso("Não foi possível conferir agora. O envio continua bloqueado.");
    } finally {
      if (vivo.current) setConferindo(false);
    }
  }
  const enviando = envio.estado === "a_enviar";
  const url = `https://app.gohighlevel.com/v2/location/${conversa.locationId}/contacts/detail/${conversa.contactId}`;
  return (
    <section className="min-w-0 space-y-4" aria-label={`Atendimento de ${conversa.nome}`}>
      <div className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{conversa.nome}</h2>
          <Button variant="outline" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> Abrir atendimento no GHL
            </a>
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          As etiquetas SIM/NÃO indicam apenas o texto recebido. A associação à consulta e o avanço
          do workflow precisam ser conferidos nos registros do GHL.
        </p>
        <div className="my-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {!result.isError && paginas[0]
              ? `Mensagens consultadas: ${formatarDataHora(paginas[0].consultadoEm, fuso)}`
              : "Consulta de mensagens"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={result.isFetching}
            onClick={() => {
              setTick((t) => t + 1);
              void result.refetch();
            }}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
        {result.isError ? (
          <ErroLeitura erro={result.error} repetir={() => void result.refetch()} />
        ) : (
          <>
            {result.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={result.isFetching}
                onClick={() => void result.fetchNextPage()}
              >
                Carregar mensagens anteriores
              </Button>
            )}
            {paginas.some((p) => p.limitePaginacao) && (
              <p className="my-3 text-sm">
                Histórico parcial: consulte o GHL para mensagens anteriores.
              </p>
            )}
            <ul
              className="mt-4 max-h-[600px] space-y-3 overflow-y-auto"
              aria-label="Mensagens do GHL"
            >
              {mensagens.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[92%] rounded-xl border border-border p-4 ${m.direcao === "outbound" ? "ml-auto bg-secondary/60" : "bg-card"}`}
                >
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">
                      {m.direcao === "inbound"
                        ? "Recebida"
                        : m.direcao === "outbound"
                          ? "Enviada"
                          : "Direção não informada"}
                    </Badge>
                    <Badge variant="secondary">{canalMensagem(m.tipo)}</Badge>
                    {respostaLiteral(m) && <Badge>Texto recebido: {respostaLiteral(m)}</Badge>}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                    {m.texto ||
                      (m.anexos ? "Mensagem com anexo" : "Sem conteúdo textual disponível")}
                  </p>
                  {m.html && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Conteúdo HTML apresentado como texto. Abra o GHL para ver a formatação.
                    </p>
                  )}
                  {m.anexos > 0 && (
                    <p className="mt-2 text-xs">{m.anexos} anexo(s) — disponíveis no GHL</p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {m.data ? formatarDataHora(m.data, fuso) : "Data não informada"} · Estado no
                    GHL: {m.estado ?? "não informado"}
                    {m.origem ? ` · Origem: ${m.origem}` : ""}
                  </p>
                  {m.provedor && (
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Provedor: {m.provedor}
                    </p>
                  )}
                  {m.erro && (
                    <p className="mt-2 text-sm text-destructive">
                      Erro informado pelo GHL: {m.erro}
                    </p>
                  )}
                  {m.direcao === "inbound" && m.texto && <JevMensagem texto={m.texto} />}
                </li>
              ))}
            </ul>
            {mensagens.length === 0 && (
              <p className="py-5 text-sm text-muted-foreground">
                {result.isPending
                  ? "A carregar mensagens…"
                  : "O GHL não devolveu mensagens para esta conversa."}
              </p>
            )}
          </>
        )}
      </div>
      {!result.isError && (
        <JevPedido
          texto={mensagens
            .filter((m) => m.direcao === "inbound" && m.texto)
            .slice(-3)
            .map((m) => m.texto)
            .join("\n")
            .slice(-4000)}
          nome={conversa.nome}
          usarRascunho={editar}
        />
      )}
      <div className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Preparar resposta</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={pendente || result.isError || mensagens.length === 0}
            onClick={() => void gerarAnalise()}
          >
            <Sparkles className="size-4" />
            {pendente ? "A analisar…" : "Analisar mensagens carregadas"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          O rascunho é temporário e exclusivo desta conversa. Corrigir é opcional; Enviar usa o
          canal verificado no servidor e fica indisponível quando não há garantia.
        </p>
        {erroIA && (
          <p role="alert" className="text-sm text-destructive">
            {erroIA}
          </p>
        )}
        {analise && (
          <div className="space-y-3">
            <p className="text-sm">{analise.resumo}</p>
            {analisadoAte !== (mensagens.at(-1)?.id ?? null) && (
              <p className="text-sm text-destructive">
                Chegaram novas mensagens. Atualize a análise antes de usar as sugestões.
              </p>
            )}
            {analise.revisao_humana && (
              <p className="text-sm">
                Tema sensível: precisa de revisão por um profissional de saúde.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              {analise.sugestoes.map((s) => (
                <article key={s.tom} className="rounded-xl border border-border p-3">
                  <Badge variant="outline">{s.tom}</Badge>
                  <p className="my-3 text-sm">{s.texto}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={enviando}
                    onClick={() => editar(s.texto)}
                  >
                    Usar rascunho
                  </Button>
                </article>
              ))}
            </div>
          </div>
        )}
        <label className="block text-sm font-medium" htmlFor="rascunho-ghl">
          Rascunho para {conversa.nome}
        </label>
        <Textarea
          id="rascunho-ghl"
          value={rascunho}
          onChange={(e) => editar(e.target.value)}
          readOnly={enviando}
          disabled={enviando}
          aria-busy={enviando}
          aria-describedby="rascunho-contador"
          rows={4}
        />
        <p
          id="rascunho-contador"
          className={`text-xs ${rascunho.trim().length > LIMITE ? "text-destructive" : "text-muted-foreground"}`}
        >
          {rascunho.trim().length}/{LIMITE} caracteres
          {rascunho.trim().length > LIMITE ? " · reduza o texto para poder corrigir ou enviar" : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Destinatário: {destino?.name ?? conversa.nome} · Canal:{" "}
          {destino?.channel ?? "não verificado"} · Transporte:{" "}
          {destino?.transport ?? "não verificado"}
        </p>
        {revisaoMudou && (
          <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
            <p>
              A conversa ou a rota de envio mudou desde que começou a rever. Confira as mensagens
              novas antes de enviar; nada foi enviado.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={enviando}
              onClick={() =>
                destino?.revision.providerId && setReferencia(destino.revision as Revisao)
              }
            >
              Conferi as mensagens novas
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!rascunho.trim() || corrigindo || enviando || rascunho.length > LIMITE}
            onClick={() => void corrigir()}
          >
            <SpellCheck className="size-4" /> {corrigindo ? "A corrigir…" : "Corrigir"}
          </Button>
          <Button
            disabled={
              !rascunho.trim() ||
              corrigindo ||
              enviando ||
              envio.estado === "incerto" ||
              !destino?.sendAllowed ||
              !referencia ||
              revisaoMudou ||
              rascunho.trim().length > LIMITE
            }
            onClick={() => void enviar()}
          >
            <Send className="size-4" /> {enviando ? "A enviar…" : `Enviar para ${conversa.nome}`}
          </Button>
        </div>
        {aviso && (
          <p role="status" className="text-sm">
            {aviso}
          </p>
        )}
        {erroDestino && (
          <p role="alert" className="text-sm text-destructive">
            {erroDestino}
          </p>
        )}
        {envio.estado === "aceite" && (
          <p role="status" className="text-sm">
            Mensagem aceite pelo GHL (ID {envio.messageId}). A entrega só fica comprovada quando o
            estado da mensagem no histórico mudar para entregue.
          </p>
        )}
        {envio.estado === "incerto" && (
          <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
            <p>
              Resultado do envio não confirmado. Não repita: confira a conversa no GHL. O texto foi
              mantido e novos envios ficam bloqueados até o estado ser recuperado.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={conferindo}
              onClick={() => void verificarEstado()}
            >
              Verificar estado do envio
            </Button>
            {envio.manualId && (
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="ID da mensagem encontrada no GHL"
                  placeholder="ID da mensagem no GHL"
                  maxLength={100}
                  value={recibo}
                  onChange={(e) => setRecibo(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={conferindo || !/^[A-Za-z0-9_-]{1,100}$/.test(recibo.trim())}
                  onClick={() => void conferir()}
                >
                  Conferir no GHL
                </Button>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Enviar envia exatamente o texto visível. A IA não faz diagnósticos.
        </p>
      </div>
    </section>
  );
}
