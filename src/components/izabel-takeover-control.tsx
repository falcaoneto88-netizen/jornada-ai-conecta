import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { getInboxAgentContext, pauseAgentContact } from "@/lib/commercial-agent.functions";
import { useModoDados } from "@/lib/repo";
import { Button } from "@/components/ui/button";

type Props = { organizationId: string; contactId: string; conversationId: string };
type View = Extract<Awaited<ReturnType<typeof getInboxAgentContext>>, { ok: true }>["data"];

function matchesScope(view: View, props: Props) {
  return (
    view.settings.organization_id === props.organizationId &&
    (!view.session || view.session.contact_id === props.contactId) &&
    view.items.every(
      (item) =>
        item.organization_id === props.organizationId &&
        item.location_id === view.settings.location_id &&
        item.contact_id === props.contactId &&
        item.conversation_id === props.conversationId,
    )
  );
}

/** Human takeover only. Opening the conversation never activates or resumes the agent. */
export function IzabelTakeoverControl(props: Props) {
  const { demo, escopo } = useModoDados();
  if (demo) return null;
  return <ConnectedTakeover key={JSON.stringify([escopo, props])} {...props} scope={escopo} />;
}

function ConnectedTakeover(props: Props & { scope: string }) {
  const { organizationId, contactId, conversationId, scope } = props;
  const read = useServerFn(getInboxAgentContext);
  const pause = useServerFn(pauseAgentContact);
  const active = useRef(true);
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    // Share the existing supervision read, avoiding a second source of conversation state.
    queryKey: ["inbox-agent-context", scope, organizationId, contactId, conversationId],
    queryFn: () => read({ data: { organizationId, contactId, conversationId } }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const view =
    query.data?.ok && !query.isError && matchesScope(query.data.data, props)
      ? query.data.data
      : null;
  const session = view?.session;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function assume() {
    if (!session || session.paused || session.opt_out || lock.current || query.isFetching) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await pause({
        data: { organizationId, contactId, expectedVersion: session.version, paused: true },
      });
      if (!active.current) return;
      if (!response.ok) {
        setError(
          response.code === "version_conflict" || response.code === "draft_stale"
            ? "O atendimento mudou. Atualize o estado antes de assumir novamente."
            : "Não foi possível confirmar a pausa. Atualize o estado antes de responder.",
        );
        await query.refetch();
        return;
      }
      const fresh = await query.refetch();
      if (!active.current) return;
      if (
        fresh.isError ||
        !fresh.data?.ok ||
        !matchesScope(fresh.data.data, props) ||
        fresh.data.data.session?.paused !== true
      )
        setError(
          "A pausa não foi confirmada na leitura atual. Atualize o estado antes de responder.",
        );
    } catch {
      if (active.current)
        setError("A pausa não foi confirmada. Atualize o estado antes de responder.");
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <div className="mt-2 space-y-1" aria-label="Controle humano deste atendimento">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          disabled={pending || query.isFetching || !session || session.paused || session.opt_out}
          onClick={() => void assume()}
        >
          <UserRound className="size-4" aria-hidden />
          {pending
            ? "A confirmar pausa…"
            : session?.paused
              ? "Com a equipe · Izabel pausada"
              : "Assumir atendimento"}
        </Button>
        {(!view || error) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10"
            disabled={pending || query.isFetching}
            onClick={() => {
              setError("");
              void query.refetch();
            }}
          >
            Atualizar controle
          </Button>
        )}
        {session?.opt_out && (
          <span className="text-xs text-muted-foreground">Contato comercial interrompido.</span>
        )}
        {view && !session && (
          <span className="text-xs text-muted-foreground">
            Sem sessão da Izabel registrada para este contato.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!view && !query.isFetching && (
        <p className="text-xs text-muted-foreground">
          Não foi possível verificar o controle deste atendimento.
        </p>
      )}
    </div>
  );
}
