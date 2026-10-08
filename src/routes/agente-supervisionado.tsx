import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  CommercialAgentQueue,
  friendlyError,
  type QueueItem,
  type QueueView,
} from "@/components/commercial-agent-queue";
import { useOrganizacao } from "@/lib/organization";
import {
  listAgentDrafts,
  approveAgentDraft,
  rejectAgentDraft,
  pauseAgentContact,
  reconcileAgentDraft,
  getManualAgentContext,
  prepareManualAgentMessage,
  sendManualAgentMessage,
  reconcileManualAgentMessage,
} from "@/lib/commercial-agent.functions";
export const Route = createFileRoute("/agente-supervisionado")({
  component: AgentPage,
  head: () => ({ meta: [{ title: "Agente supervisionado — Jornada AI" }] }),
});
function AgentPage() {
  const org = useOrganizacao();
  return (
    <AppShell
      title="Agente supervisionado"
      description="Atendimento comercial com aprovação da equipe"
    >
      {org.data ? (
        <ConnectedQueue key={org.data.organizacao.id} org={org.data.organizacao.id} />
      ) : (
        <p>Entre na sua conta para consultar a fila da clínica.</p>
      )}
    </AppShell>
  );
}
function ConnectedQueue({ org }: { org: string }) {
  const list = useServerFn(listAgentDrafts),
    approve = useServerFn(approveAgentDraft),
    reject = useServerFn(rejectAgentDraft),
    pause = useServerFn(pauseAgentContact),
    reconcile = useServerFn(reconcileAgentDraft),
    manualContext = useServerFn(getManualAgentContext),
    manualPrepare = useServerFn(prepareManualAgentMessage),
    manualSend = useServerFn(sendManualAgentMessage),
    manualReconcile = useServerFn(reconcileManualAgentMessage);
  const [view, setView] = useState<QueueView | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    const r = await list({ data: { organizationId: org } });
    if (!r.ok) throw new Error(r.code);
    setView(r.data);
    setError("");
  }
  useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        const r = await list({ data: { organizationId: org } });
        if (live) {
          if (r.ok) {
            setView(r.data);
            setError("");
          } else setError(r.code);
        }
      } catch {
        if (live) setError("unavailable");
      }
    };
    void run();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [org, list]);
  const input = (row: QueueItem) => ({
    organizationId: org,
    draftId: row.id,
    version: row.version,
    replyHash: row.reply_hash,
  });
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-xl border p-4 text-sm">
          {friendlyError[error] ?? "Fila indisponível. Atualize a página."}
        </p>
      )}
      {view ? (
        <CommercialAgentQueue
          view={view}
          actions={{
            refresh,
            manual: {
              refresh,
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
