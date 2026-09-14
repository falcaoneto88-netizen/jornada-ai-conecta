import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
  const analisar = useServerFn(aiSupport);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
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
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Rascunho copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto manualmente.");
    }
  }
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
            onClick={() => void result.refetch()}
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
          O rascunho é temporário e exclusivo desta conversa. O envio deve ser feito no atendimento
          do GHL; o canal/provedor de envio pelo app ainda não foi homologado.
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
                  <Button size="sm" variant="outline" onClick={() => setRascunho(s.texto)}>
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
          onChange={(e) => setRascunho(e.target.value)}
          rows={4}
        />
        <Button disabled={!rascunho.trim()} variant="outline" onClick={() => void copiar(rascunho)}>
          <Copy className="size-4" /> Copiar rascunho
        </Button>
        <p className="text-xs text-muted-foreground">
          Reveja destinatário e conteúdo no GHL. A IA não faz diagnósticos.
        </p>
      </div>
    </section>
  );
}
