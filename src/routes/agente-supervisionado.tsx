import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { id } from "@/lib/commercial-agent/core";
import { AppShell } from "@/components/app-shell";
import "@/components/supervision-art-direction.css";
import { useModoDados } from "@/lib/repo";
import {
  CommercialAgentQueue,
  friendlyError,
  type QueueItem,
  type QueueView,
} from "@/components/commercial-agent-queue";
import { useOrganizacao } from "@/lib/organization";
import {
  getInboxAgentContext,
  approveAgentDraft,
  rejectAgentDraft,
  pauseAgentContact,
  reconcileAgentDraft,
  getManualAgentContext,
  prepareManualAgentMessage,
  sendManualAgentMessage,
  reconcileManualAgentMessage,
} from "@/lib/commercial-agent.functions";
import {
  listAgentQueuePage,
  searchManualAgentConversations,
} from "@/lib/commercial-agent-queue.functions";
import type { AgentQueueRequest } from "@/lib/commercial-agent/queue-read";
const reviewSearchSchema = z
  .object({
    contactId: id.optional(),
    conversationId: id.optional(),
    draftId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.contactId) === Boolean(value.conversationId) &&
      (!value.draftId || Boolean(value.contactId)),
  );
type ReviewScope = { contactId: string; conversationId: string; draftId?: string };
export const Route = createFileRoute("/agente-supervisionado")({
  validateSearch: (search) => reviewSearchSchema.parse(search),
  component: AgentPage,
  head: () => ({ meta: [{ title: "Agente supervisionado — Jornada AI" }] }),
});
function AgentPage() {
  const org = useOrganizacao();
  const { escopo } = useModoDados();
  const search = Route.useSearch();
  const scope: ReviewScope | undefined =
    search.contactId && search.conversationId
      ? {
          contactId: search.contactId,
          conversationId: search.conversationId,
          ...(search.draftId ? { draftId: search.draftId } : {}),
        }
      : undefined;
  return (
    <div className="supervision-art-direction">
      <AppShell title="Agente supervisionado">
        {org.data ? (
          <>
            <ConnectedQueue
              key={JSON.stringify([escopo, org.data.organizacao.id, scope])}
              org={org.data.organizacao.id}
              {...(scope ? { scope } : {})}
            />
            {!scope && (
              <div className="mt-6 border-t pt-5">
                <p className="text-sm text-muted-foreground">
                  A Izabel prepara respostas com a base V02 no Meu Chat. O pacote novo de protocolos
                  e imagens continua em homologação; esta fila preserva a triagem e a auditoria das
                  sugestões supervisionadas.
                </p>
              </div>
            )}
          </>
        ) : (
          <p>Entre na sua conta para consultar a fila da clínica.</p>
        )}
      </AppShell>
    </div>
  );
}
function ConnectedQueue({ org, scope }: { org: string; scope?: ReviewScope }) {
  const list = useServerFn(listAgentQueuePage),
    manualSearch = useServerFn(searchManualAgentConversations),
    scopedList = useServerFn(getInboxAgentContext),
    approve = useServerFn(approveAgentDraft),
    reject = useServerFn(rejectAgentDraft),
    pause = useServerFn(pauseAgentContact),
    reconcile = useServerFn(reconcileAgentDraft),
    manualContext = useServerFn(getManualAgentContext),
    manualPrepare = useServerFn(prepareManualAgentMessage),
    manualSend = useServerFn(sendManualAgentMessage),
    manualReconcile = useServerFn(reconcileManualAgentMessage);
  const [view, setView] = useState<QueueView | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  type PageRequest = Omit<AgentQueueRequest, "organizationId">;
  const pageRequest = useRef<PageRequest>({ category: "review", query: "", page: 1, pageSize: 20 });
  const requestGeneration = useRef(0);
  // Primitive dependencies avoid restarting the read on unrelated parent renders.
  const contactId = scope?.contactId,
    conversationId = scope?.conversationId,
    draftId = scope?.draftId;
  const load = useCallback(
    async (request: PageRequest) => {
      const generation = ++requestGeneration.current;
      pageRequest.current = request;
      setLoading(true);
      try {
        const r =
          contactId && conversationId
            ? await scopedList({
                data: {
                  organizationId: org,
                  contactId,
                  conversationId,
                  ...(draftId ? { draftId } : {}),
                },
              })
            : await list({ data: { ...request, organizationId: org } });
        if (generation !== requestGeneration.current) return;
        if (!r.ok) throw new Error(r.code);
        const next = r.data as QueueView;
        setView(next);
        setError("");
        if (next.pagination) {
          const { category, query, page, pageSize, asOf } = next.pagination;
          pageRequest.current = { category, query, page, pageSize, asOf };
        }
      } catch (cause) {
        if (generation !== requestGeneration.current) return;
        setError(cause instanceof Error ? cause.message : "unavailable");
        throw cause;
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [org, list, scopedList, contactId, conversationId, draftId],
  );
  const refresh = () => {
    const { category, query, pageSize } = pageRequest.current;
    return load({ category, query, page: 1, pageSize });
  };
  useEffect(() => {
    const run = () => void load(pageRequest.current).catch(() => undefined);
    run();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, 15000);
    return () => {
      requestGeneration.current += 1;
      clearInterval(t);
    };
  }, [load]);
  const input = (row: QueueItem) => ({
    organizationId: org,
    draftId: row.id,
    version: row.version,
    replyHash: row.reply_hash,
  });
  return (
    <>
      {scope && (
        <p className="mb-4 text-sm text-muted-foreground">
          Revisão aberta a partir do Atendimento, limitada ao contato e à conversa selecionados.
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-xl border p-4 text-sm">
          <p>
            {friendlyError[error] ??
              "Não foi possível atualizar a fila. As ações ficam bloqueadas até conferir os dados novamente."}
          </p>
          <button
            type="button"
            disabled={loading}
            className="mt-2 min-h-10 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => void refresh().catch(() => undefined)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {view ? (
        <CommercialAgentQueue
          view={view}
          focused={Boolean(scope)}
          loading={loading}
          unavailable={Boolean(error)}
          actions={{
            refresh,
            navigate: load,
            manual: {
              refresh,
              search: async (request) => {
                const r = await manualSearch({ data: { ...request, organizationId: org } });
                if (!r.ok) throw new Error(r.code);
                return r.data;
              },
              context: async (conversation) => {
                const r = await manualContext({
                  data: {
                    organizationId: org,
                    contactId: conversation.contactId,
                    conversationId: conversation.conversationId,
                  },
                });
                if (!r.ok) throw new Error(r.code);
                return r.data;
              },
              pause: async (conversation, expectedVersion, paused) => {
                const r = await pause({
                  data: {
                    organizationId: org,
                    contactId: conversation.contactId,
                    expectedVersion,
                    paused,
                  },
                });
                if (!r.ok) throw new Error(r.code);
              },
              prepare: async (input) => {
                const r = await manualPrepare({ data: { ...input, organizationId: org } });
                if (!r.ok) throw new Error(r.code);
                return r.data;
              },
              send: async (prepared) => {
                const r = await manualSend({
                  data: {
                    organizationId: org,
                    manualId: prepared.id,
                    replyHash: prepared.replyHash,
                  },
                });
                if (!r.ok) throw new Error(r.code);
                return r.data;
              },
              reconcile: async (manualId, messageId) => {
                const r = await manualReconcile({
                  data: { organizationId: org, manualId, messageId },
                });
                if (!r.ok) throw new Error(r.code);
              },
            },
            reconcile: async (row, messageId) => {
              const r = await reconcile({
                data: { organizationId: org, draftId: row.id, messageId },
              });
              if (!r.ok) throw new Error(r.code);
            },
            approve: async (row) => {
              const r = await approve({ data: input(row) });
              if (!r.ok) throw new Error(r.code);
              return r.data.state;
            },
            reject: async (row) => {
              const r = await reject({ data: input(row) });
              if (!r.ok) throw new Error(r.code);
            },
            pause: async (row, paused) => {
              const r = await pause({
                data: {
                  organizationId: org,
                  contactId: row.contact_id,
                  expectedVersion: row.session_version ?? 0,
                  paused,
                },
              });
              if (!r.ok) throw new Error(r.code);
            },
          }}
        />
      ) : (
        !error && <p role="status">Carregando fila…</p>
      )}
    </>
  );
}
