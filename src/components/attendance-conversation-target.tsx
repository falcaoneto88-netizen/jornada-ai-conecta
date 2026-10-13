import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { resolveAttendanceConversations } from "@/lib/attendance-workspace.functions";
import type { AttendanceConversationResolution } from "@/lib/attendance-workspace.core";
import { canalMensagem, type ConversaGhl } from "@/lib/ghl-observation.core";
import { formatarDataHora } from "@/lib/clinic-time";
import { Button } from "./ui/button";

type Candidate = AttendanceConversationResolution["conversations"][number];
function attendanceConversation(candidate: Candidate): ConversaGhl {
  return {
    id: candidate.id,
    contactId: candidate.contactId,
    locationId: candidate.locationId,
    nome: candidate.name,
    tipo: candidate.channel,
    ultimaData: candidate.lastMessageAt,
    ultimaMensagem: "",
    naoLidas: null,
  };
}
/** Resolve only the exact GHL contact. A filtered or missing target never opens a different person. */
export function AttendanceConversationTarget({
  organizationId,
  ghlContactId,
  conversationId,
  scope,
  fuso,
  children,
}: {
  organizationId: string;
  ghlContactId: string;
  conversationId?: string | undefined;
  scope: string;
  fuso: string;
  children: (conversation: ConversaGhl) => ReactNode;
}) {
  const resolve = useServerFn(resolveAttendanceConversations);
  const [choice, setChoice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["attendance-conversation-target", scope, organizationId, ghlContactId],
    queryFn: () => resolve({ data: { organizationId, ghlContactId } }),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const data = query.data?.ok ? query.data.data : null;
  const failure = query.data && !query.data.ok ? query.data : null;
  const valid =
    data?.organizationId === organizationId &&
    data.ghlContactId === ghlContactId &&
    data.conversations.every(
      (c) => c.contactId === ghlContactId && c.locationId === data.locationId,
    );
  const candidates = valid ? data.conversations : [];
  const requested = choice ?? conversationId;
  const selected = requested
    ? candidates.find((c) => c.id === requested)
    : data?.resolution === "single" && data.complete && candidates.length === 1
      ? candidates[0]
      : undefined;
  if (selected) return children(attendanceConversation(selected));
  return (
    <section
      className="surface-card max-w-xl space-y-4 p-5"
      aria-label="Escolher conversa do contato"
    >
      <h2 className="font-semibold">Abrir o atendimento correto</h2>
      {query.isPending ? (
        <p role="status">A conferir o contato e suas conversas na subconta conectada…</p>
      ) : query.isError || failure || !valid ? (
        <div role="alert">
          <p>
            {failure?.message ??
              "Não foi possível confirmar as conversas deste contato. Nenhuma outra conversa foi aberta."}
          </p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          {requested && !selected && (
            <p role="alert" className="text-sm text-destructive">
              A conversa indicada não foi encontrada para este contato. Escolha uma opção conferida
              abaixo.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {data.resolution === "incomplete"
              ? "A consulta ao GHL foi parcial. Escolha explicitamente uma das conversas encontradas ou consulte o GHL."
              : candidates.length
                ? "Este contato tem mais de uma conversa. Confira o canal antes de continuar."
                : "Nenhuma conversa foi localizada para este contato. Não criamos uma conversa automaticamente."}
          </p>
          <ul className="space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal py-3 text-left"
                  onClick={() => setChoice(candidate.id)}
                >
                  <span>
                    <span className="block font-medium">
                      {candidate.name} · {canalMensagem(candidate.channel)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {candidate.lastMessageAt
                        ? formatarDataHora(candidate.lastMessageAt, fuso)
                        : "Última mensagem sem data"}{" "}
                      · Conversa {candidate.id}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="break-all text-xs text-muted-foreground">
            Contato GHL: {ghlContactId} · Consultado {formatarDataHora(data.checkedAt, fuso)}
          </p>
        </>
      )}
    </section>
  );
}
