import { useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useModoDados, usePermissoes, type Marcacao } from "@/lib/repo";
import { useOrganizacao } from "@/lib/organization";
import {
  getAppointmentEvidence,
  getAppointmentTracking,
  recordAppointmentEvidence,
} from "@/lib/appointment-tracking.functions";
import {
  rotulosAcompanhamento,
  type EstadoAcompanhamento,
  type EstadoRegistavel,
  type EvidenciaConsulta,
} from "@/lib/appointment-tracking.core";
import { formatarDataHora } from "@/lib/clinic-time";
import { canalMensagem, type MensagemGhl } from "@/lib/ghl-observation.core";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function AppointmentTracking({ marcacoes }: { marcacoes: Marcacao[] }) {
  const { escopo, demo } = useModoDados();
  const org = useOrganizacao();
  if (demo) return null;
  if (org.isError)
    return <p role="alert">Não foi possível identificar a clínica para acompanhamento.</p>;
  if (!org.data) return <p>A carregar acompanhamento…</p>;
  return (
    <Quadro
      key={`${escopo}:${org.data.organizacao.id}`}
      marcacoes={marcacoes}
      org={org.data.organizacao.id}
      fuso={org.data.organizacao.timezone}
      escopo={escopo}
    />
  );
}

function Quadro({
  marcacoes,
  org,
  fuso,
  escopo,
}: {
  marcacoes: Marcacao[];
  org: string;
  fuso: string;
  escopo: string;
}) {
  const [filtro, setFiltro] = useState("todos");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [editar, setEditar] = useState(false);
  const ler = useServerFn(getAppointmentTracking);
  const permissoes = usePermissoes();
  const ids = marcacoes.map((m) => m.id).sort();
  const query = useQuery({
    queryKey: ["acompanhamento", escopo, org, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const partes = [];
      for (let i = 0; i < ids.length; i += 200)
        partes.push(
          await ler({ data: { organizationId: org, appointmentIds: ids.slice(i, i + 200) } }),
        );
      return {
        consultas: partes.flatMap((p) => p.consultas),
        locationId: partes[0]!.locationId,
        consultadoEm: partes[0]!.consultadoEm,
      };
    },
    retry: false,
    refetchInterval: 30_000,
  });
  const selecionadaAtual = marcacoes.find((m) => m.id === selecionada);
  const detalhe = query.data?.consultas.find((c) => c.appointmentId === selecionada);
  const estados = Object.keys(rotulosAcompanhamento) as EstadoAcompanhamento[];
  const listadas = marcacoes.filter(
    (m) =>
      filtro === "todos" ||
      query.data?.consultas.find((c) => c.appointmentId === m.id)?.estado === filtro,
  );
  return (
    <section className="surface-card space-y-4 p-5" aria-label="Acompanhamento das consultas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Acompanhamento das consultas</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || ids.length === 0}
        >
          <RefreshCw className="size-4" />
          Atualizar acompanhamento
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Estados baseados em mensagens reais associadas pela equipe. A confirmação administrativa da
        agenda e a execução do workflow são informações separadas.
      </p>
      <p className="text-xs text-muted-foreground">
        Sem evidência vinculada, o app não assume confirmação nem ausência de resposta. Horários:{" "}
        {fuso}. Este quadro acompanha as consultas do período e responsável selecionados acima. A
        data e o estado administrativo dependem da última sincronização da agenda.
      </p>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : ids.length === 0 ? (
        <p className="text-sm">Nenhuma consulta neste período.</p>
      ) : query.isPending ? (
        <p>A carregar evidências…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Atualizado: {query.data && formatarDataHora(query.data.consultadoEm, fuso)}. O prazo é
            recalculado a cada atualização.
          </p>
          <div className="flex flex-wrap gap-2">
            {estados.map((e) => (
              <Badge key={e} variant="outline">
                {rotulosAcompanhamento[e]}:{" "}
                {query.data?.consultas.filter((c) => c.estado === e).length ?? 0}
              </Badge>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm">
            Filtrar acompanhamento
            <select
              className="rounded-md border bg-card p-2"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            >
              <option value="todos">Todos os estados</option>
              {estados.map((e) => (
                <option key={e} value={e}>
                  {rotulosAcompanhamento[e]}
                </option>
              ))}
            </select>
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left">Consulta</th>
                  <th className="p-3 text-left">Acompanhamento</th>
                  <th className="p-3 text-left">Evidência</th>
                </tr>
              </thead>
              <tbody>
                {listadas.map((m) => {
                  const c = query.data?.consultas.find((x) => x.appointmentId === m.id);
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="p-3">
                        <p className="font-medium">{m.cliente}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.inicio} · {m.titulo}
                        </p>
                      </td>
                      <td className="p-3">
                        <Badge variant={c?.estado === "falha" ? "destructive" : "outline"}>
                          {c ? rotulosAcompanhamento[c.estado] : "Não consultado"}
                        </Badge>
                        {c?.evidencia?.deadline_at && (
                          <p className="mt-2 text-xs">
                            Prazo: {formatarDataHora(c.evidencia.deadline_at, fuso)}
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelecionada(m.id);
                            setEditar(false);
                          }}
                        >
                          Ver acompanhamento
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {listadas.length === 0 && (
            <p className="text-sm">Nenhuma consulta com este estado no período.</p>
          )}
        </>
      )}
      <Dialog
        open={Boolean(selecionadaAtual)}
        onOpenChange={(v) => {
          if (!v) {
            setSelecionada(null);
            setEditar(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selecionadaAtual?.cliente} — acompanhamento</DialogTitle>
            <DialogDescription>
              {selecionadaAtual?.inicio} · {fuso} · Evidência associada especificamente a esta
              consulta.
            </DialogDescription>
          </DialogHeader>
          {query.isError ? (
            <p role="alert">Falha ao atualizar as evidências. Atualize antes de continuar.</p>
          ) : (
            detalhe &&
            selecionadaAtual && (
              <>
                <Badge variant={detalhe.estado === "falha" ? "destructive" : "outline"}>
                  {rotulosAcompanhamento[detalhe.estado]}
                </Badge>
                <p className="text-sm">{detalhe.motivo}</p>
                <p className="text-xs text-muted-foreground">
                  Associar evidência atualiza somente este acompanhamento. Não envia mensagens nem
                  confirma, cancela ou remarca no GHL.
                </p>
                {permissoes.operar && detalhe.estado !== "cancelada" && (
                  <Button variant="outline" onClick={() => setEditar((v) => !v)}>
                    {editar ? "Fechar associação" : "Associar mensagem como evidência"}
                  </Button>
                )}
                {editar && (
                  <SelecionarEvidencia
                    key={`${selecionadaAtual.id}:${detalhe.evidencia?.id ?? "sem"}`}
                    org={org}
                    consulta={selecionadaAtual}
                    fuso={fuso}
                    previous={detalhe.evidencia}
                    aoGuardar={() => setEditar(false)}
                  />
                )}
                <h3 className="mt-3 font-semibold">Histórico de evidências</h3>
                <p className="text-xs text-muted-foreground">
                  Cada registro preserva um trecho de até 2.000 caracteres da mensagem verificada.
                </p>
                {detalhe.historico.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma evidência registrada.</p>
                ) : (
                  <ol className="space-y-3">
                    {detalhe.historico.map((e) => (
                      <li key={e.id} className="rounded-xl border p-4">
                        <Badge variant="outline">{rotulosAcompanhamento[e.state]}</Badge>
                        <p className="my-3 whitespace-pre-wrap break-words text-sm">
                          {e.message_text}
                        </p>
                        <p className="text-xs">
                          Mensagem: {formatarDataHora(e.message_at, fuso)} ·{" "}
                          {canalMensagem(e.message_type)} · Estado verificado:{" "}
                          {e.message_status ?? "não informado"}
                        </p>
                        {e.deadline_at && (
                          <p className="text-xs">
                            Prazo registrado: {formatarDataHora(e.deadline_at, fuso)}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          Associada por {e.actor_name} em {formatarDataHora(e.recorded_at, fuso)}.
                          Consulta à época: {formatarDataHora(e.appointment_start_at, fuso)}.
                        </p>
                        <p className="mt-2 break-all text-xs text-muted-foreground">
                          Mensagem {e.message_id}
                        </p>
                        <a
                          className="mt-2 inline-flex items-center gap-1 text-sm underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`https://app.gohighlevel.com/v2/location/${query.data!.locationId}/contacts/detail/${e.ghl_contact_id}`}
                        >
                          <ExternalLink className="size-3" />
                          Abrir contato no GHL
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SelecionarEvidencia({
  org,
  consulta,
  fuso,
  previous,
  aoGuardar,
}: {
  org: string;
  consulta: Marcacao;
  fuso: string;
  previous: EvidenciaConsulta | null;
  aoGuardar: () => void;
}) {
  const { escopo } = useModoDados();
  const [conversationId, setConversationId] = useState("");
  const [mensagem, setMensagem] = useState<MensagemGhl | null>(null);
  const ler = useServerFn(getAppointmentEvidence);
  const conversas = useQuery({
    queryKey: ["evidencia-conversas", escopo, org, consulta.id],
    queryFn: () => ler({ data: { organizationId: org, appointmentId: consulta.id } }),
    retry: false,
  });
  const paginas = useInfiniteQuery({
    queryKey: ["evidencia-mensagens", escopo, org, consulta.id, conversationId],
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      ler({
        data: {
          organizationId: org,
          appointmentId: consulta.id,
          conversationId,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (p) => (p.tipo === "mensagens" ? (p.proximoCursor ?? undefined) : undefined),
    retry: false,
  });
  const lista = Array.from(
    new Map(
      (paginas.data?.pages.flatMap((p) => (p.tipo === "mensagens" ? p.mensagens : [])) ?? []).map(
        (m) => [m.id, m],
      ),
    ).values(),
  ).sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="text-sm font-medium">
        Escolha a conversa e a mensagem que se referem à consulta de {consulta.inicio}. Primeiro
        associe a solicitação enviada; depois a resposta recebida, se houver.
      </p>
      {conversas.isError ? (
        <p role="alert">{conversas.error.message}</p>
      ) : conversas.isPending ? (
        <p>A consultar conversas…</p>
      ) : (
        <select
          className="w-full rounded-md border bg-card p-2"
          aria-label="Conversa da evidência"
          value={conversationId}
          onChange={(e) => {
            setConversationId(e.target.value);
            setMensagem(null);
          }}
        >
          <option value="">Selecione uma conversa</option>
          {conversas.data.tipo === "conversas" &&
            conversas.data.conversas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {canalMensagem(c.tipo)} ·{" "}
                {c.ultimaData ? formatarDataHora(c.ultimaData, fuso) : c.id}
              </option>
            ))}
        </select>
      )}
      {paginas.isError ? (
        <p role="alert">{paginas.error.message}</p>
      ) : (
        conversationId && (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {lista.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setMensagem(m)}
                  aria-pressed={mensagem?.id === m.id}
                  className={`block w-full rounded-lg border p-3 text-left text-sm ${mensagem?.id === m.id ? "bg-secondary" : ""}`}
                >
                  <span className="text-xs text-muted-foreground">
                    {m.data ? formatarDataHora(m.data, fuso) : "Sem data"} · {m.direcao} ·{" "}
                    {canalMensagem(m.tipo)} · {m.estado}
                  </span>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{m.texto || "Sem texto"}</p>
                </button>
              ))}
            </div>
            {!paginas.isFetching && lista.length === 0 && (
              <p>Nenhuma mensagem disponível nesta conversa.</p>
            )}
            {paginas.isFetching && <p>A consultar mensagens…</p>}
            {paginas.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                disabled={paginas.isFetching}
                onClick={() => void paginas.fetchNextPage()}
              >
                Carregar mensagens anteriores
              </Button>
            )}
          </>
        )
      )}
      {mensagem && !paginas.isError && (
        <Registar
          key={`${conversationId}:${mensagem.id}`}
          org={org}
          consulta={consulta}
          fuso={fuso}
          conversationId={conversationId}
          mensagem={mensagem}
          previous={previous}
          aoGuardar={aoGuardar}
        />
      )}
    </div>
  );
}

function Registar({
  org,
  consulta,
  fuso,
  conversationId,
  mensagem,
  previous,
  aoGuardar,
}: {
  org: string;
  consulta: Marcacao;
  fuso: string;
  conversationId: string;
  mensagem: MensagemGhl;
  previous: EvidenciaConsulta | null;
  aoGuardar: () => void;
}) {
  const [estado, setEstado] = useState<EstadoRegistavel>(
    mensagem.direcao === "inbound"
      ? "presenca_confirmada"
      : ["failed", "undelivered"].includes(mensagem.estado ?? "")
        ? "falha"
        : "aguardando_resposta",
  );
  const [horas, setHoras] = useState<1 | 3 | 12 | 24 | 48>(24);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const guardar = useServerFn(recordAppointmentEvidence);
  const qc = useQueryClient();
  const deadline = mensagem.data
    ? new Date(Date.parse(mensagem.data) + horas * 3600000).toISOString()
    : null;
  async function save() {
    if (!confirm || pending) return;
    setPending(true);
    setErro(null);
    try {
      await guardar({
        data: {
          organizationId: org,
          appointmentId: consulta.id,
          conversationId,
          messageId: mensagem.id,
          estado,
          prazoHoras: estado === "aguardando_resposta" ? horas : null,
          previousId: previous?.id ?? null,
          requestId,
          confirm: true,
        },
      });
      await qc.invalidateQueries({ queryKey: ["acompanhamento"] });
      toast.success("Evidência registrada no acompanhamento.");
      aoGuardar();
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível confirmar o registro. Atualize antes de repetir.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary p-3 text-sm">
        {mensagem.texto}
      </p>
      <label className="block text-sm">
        Estado a registrar
        <select
          className="mt-1 w-full rounded-md border bg-card p-2"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value as EstadoRegistavel);
            setConfirm(false);
          }}
        >
          <option value="aguardando_resposta">Aguardando resposta — solicitação enviada</option>
          <option value="presenca_confirmada">Presença confirmada — resposta recebida</option>
          <option value="remarcacao_solicitada">Pedido de remarcação — resposta recebida</option>
          <option value="falha">Falha — mensagem failed/undelivered</option>
        </select>
      </label>
      {estado === "aguardando_resposta" && (
        <label className="block text-sm">
          Prazo após o envio
          <select
            className="ml-2 rounded-md border bg-card p-2"
            value={horas}
            onChange={(e) => {
              setHoras(Number(e.target.value) as typeof horas);
              setConfirm(false);
            }}
          >
            {[1, 3, 12, 24, 48].map((h) => (
              <option value={h} key={h}>
                {h} horas
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs">
            Encerramento: {deadline ? formatarDataHora(deadline, fuso) : "data indisponível"}. O app
            considera respostas vinculadas pela equipe; não mede o timeout do GHL.
          </p>
        </label>
      )}
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Revisei o texto e confirmo que ele corresponde a {consulta.cliente}, consulta de{" "}
        {consulta.inicio}, como {rotulosAcompanhamento[estado].toLowerCase()}.
      </label>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <Button onClick={() => void save()} disabled={!confirm || pending}>
        {pending ? "A verificar e registrar…" : "Registrar evidência"}
      </Button>
    </div>
  );
}
