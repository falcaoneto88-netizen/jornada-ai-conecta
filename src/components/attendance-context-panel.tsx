import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, RefreshCw, Save } from "lucide-react";
import { useModoDados } from "@/lib/repo";
import { formatarDataHora } from "@/lib/clinic-time";
import { readAttendanceContext, saveAttendanceContext } from "@/lib/attendance-context.functions";
import type {
  AttendanceContext,
  AttendanceResult,
  AttendanceSaveInput,
} from "@/lib/attendance-context.core";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";

type AttendanceContextPanelProps = {
  organizationId: string;
  ghlContactId: string;
  conversationId?: string;
  fuso: string;
};

export function AttendanceContextPanel(props: AttendanceContextPanelProps) {
  const { escopo, demo } = useModoDados();
  if (demo) return null;
  return (
    <ContextPanel
      key={JSON.stringify([escopo, props.organizationId, props.ghlContactId, props.conversationId])}
      {...props}
      scope={escopo}
    />
  );
}

function civilTime(value: string | null, timezone: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function ContextPanel({
  organizationId,
  ghlContactId,
  fuso,
  scope,
}: AttendanceContextPanelProps & { scope: string }) {
  const read = useServerFn(readAttendanceContext);
  const queryKey = ["attendance-context", scope, organizationId, ghlContactId];
  const query = useQuery({
    queryKey,
    queryFn: () => read({ data: { organizationId, ghlContactId } }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const data = query.data?.ok ? query.data.data : null;
  const failure = query.data && !query.data.ok ? query.data : null;
  return (
    <section className="min-w-0 space-y-4 p-4 text-sm" aria-label="Contexto do atendimento">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-heading">Contexto do atendimento</h2>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            Horários: {data?.timezone ?? fuso}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Atualizar contexto"
          title="Atualizar contexto"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {query.isPending ? (
        <p role="status" className="text-muted-foreground">
          A carregar contexto…
        </p>
      ) : query.isError ? (
        <p role="alert" className="text-destructive">
          Não foi possível consultar o contexto. Tente atualizar.
        </p>
      ) : failure ? (
        <div
          className="space-y-2"
          role={failure.code === "contact_not_synced" ? "status" : "alert"}
        >
          <p className="font-medium">
            {failure.code === "contact_not_synced"
              ? "Contato ainda sem vínculo no app"
              : failure.code === "forbidden"
                ? "Acesso indisponível"
                : "Contexto indisponível"}
          </p>
          <p className="text-xs text-muted-foreground">{failure.message}</p>
          {failure.code === "contact_not_synced" && (
            <p className="text-xs text-muted-foreground">
              Não é possível registrar responsável ou retorno até existir o vínculo deste contato.
            </p>
          )}
        </div>
      ) : data ? (
        <>
          <AttendanceEditor key={data.contact.id} data={data} queryKey={queryKey} />
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Cadastro e etapa</summary>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="font-medium">Contato</h3>
                <p className="break-words">{data.contact.name}</p>
                {data.contact.phone && (
                  <p className="break-all text-xs text-muted-foreground">{data.contact.phone}</p>
                )}
                {data.contact.email && (
                  <p className="break-all text-xs text-muted-foreground">{data.contact.email}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Etapa no cadastro do app</p>
                <p>{data.stage?.name ?? "Etapa não disponível"}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Cadastro atualizado: {formatarDataHora(data.contact.updatedAt, data.timezone)}
              </p>
            </div>
          </details>
          <div className="space-y-2 rounded-lg border p-3">
            <h3 className="font-medium">Próxima consulta no app</h3>
            {data.nextAppointment ? (
              <>
                <p className="break-words">{data.nextAppointment.title || "Consulta"}</p>
                <p>{formatarDataHora(data.nextAppointment.startAt, data.timezone)}</p>
                <Badge variant="outline" className="max-w-full whitespace-normal">
                  Estado na agenda: {data.nextAppointment.status}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Atualizada: {formatarDataHora(data.nextAppointment.updatedAt, data.timezone)}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma próxima consulta disponível no cadastro do app.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Fonte: cadastro e agenda do Jornada AI. Consultado em{" "}
            {formatarDataHora(data.checkedAt, data.timezone)}. Estes dados não são uma consulta ao
            GHL em tempo real.
          </p>
        </>
      ) : null}
    </section>
  );
}

function AttendanceEditor({ data, queryKey }: { data: AttendanceContext; queryKey: string[] }) {
  const id = useId();
  const save = useServerFn(saveAttendanceContext);
  const queryClient = useQueryClient();
  const initial = (context: AttendanceContext) => ({
    version: context.attendance.version,
    timezone: context.timezone,
    ownerId: context.attendance.ownerId ?? "",
    text: context.attendance.nextAction ?? "",
    due: civilTime(context.attendance.nextActionAt, context.timezone),
  });
  const [baseline, setBaseline] = useState(() => initial(data));
  const [owner, setOwner] = useState(baseline.ownerId);
  const [text, setText] = useState(baseline.text);
  const [due, setDue] = useState(baseline.due);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = owner !== baseline.ownerId || text !== baseline.text || due !== baseline.due;
  const remoteChanged =
    baseline.version !== data.attendance.version || baseline.timezone !== data.timezone;
  const blocked = !data.canEdit || pending || remoteChanged || conflict;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    // Another mounted panel may save this contact. Do not replace an authored edit.
    if (dirty || pending || !remoteChanged) return;
    const next = {
      version: data.attendance.version,
      timezone: data.timezone,
      ownerId: data.attendance.ownerId ?? "",
      text: data.attendance.nextAction ?? "",
      due: civilTime(data.attendance.nextActionAt, data.timezone),
    };
    setBaseline(next);
    setOwner(next.ownerId);
    setText(next.text);
    setDue(next.due);
    setConflict(false);
    setError(null);
  }, [dirty, pending, remoteChanged, data.attendance, data.timezone]);
  function reset(context: AttendanceContext) {
    const next = initial(context);
    setBaseline(next);
    setOwner(next.ownerId);
    setText(next.text);
    setDue(next.due);
    setError(null);
    setNotice(null);
    setConflict(false);
  }
  function edit(change: () => void) {
    if (pendingRef.current) return;
    change();
    setError(null);
    setNotice(null);
  }
  async function submit(complete = false) {
    if (pendingRef.current || !data.canEdit || remoteChanged || conflict || (complete && dirty))
      return;
    const returnChanged = text !== baseline.text || due !== baseline.due;
    if (!complete && returnChanged && (!text.trim() || text.trim().length > 500 || !due)) {
      setError("Preencha a próxima ação (até 500 caracteres) e o prazo para salvar o retorno.");
      return;
    }
    if (!complete && !dirty) return;
    if (complete && !data.attendance.nextAction) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const input: AttendanceSaveInput = {
      organizationId: data.organizationId,
      ghlContactId: data.contact.ghlContactId,
      expectedVersion: baseline.version,
      expectedTimezone: baseline.timezone,
      ownerId: owner || null,
      returnAction: complete ? "complete" : returnChanged ? "set" : "keep",
      ...(!complete && returnChanged ? { returnText: text.trim(), dueLocal: due } : {}),
    };
    try {
      const result = await save({ data: input });
      if (result.ok) {
        // Refresh every owner/view filter for this same session and organization.
        void queryClient.invalidateQueries({
          queryKey: ["attendance-workspace", queryKey[1], data.organizationId],
        });
        await queryClient.cancelQueries({ queryKey });
        queryClient.setQueryData<AttendanceResult>(queryKey, (current) =>
          current?.ok &&
          (current.data.attendance.version > result.data.attendance.version ||
            (current.data.attendance.version === result.data.attendance.version &&
              Date.parse(current.data.checkedAt) > Date.parse(result.data.checkedAt)))
            ? current
            : result,
        );
        if (alive.current) {
          reset(result.data);
          setNotice(
            complete ? "Retorno concluído no Jornada AI." : "Acompanhamento salvo no Jornada AI.",
          );
        }
      } else if (alive.current) {
        setError(result.message);
        if (result.code === "conflict") {
          setConflict(true);
          void queryClient.invalidateQueries({ queryKey });
        }
      }
    } catch {
      if (alive.current)
        setError(
          "Não foi possível confirmar o registro. Atualize o contexto antes de tentar novamente.",
        );
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  }
  const selectedOwner = data.team.find((member) => member.id === data.attendance.ownerId);
  if (!data.canEdit)
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <h3 className="font-medium">Acompanhamento interno</h3>
        <p className="text-xs">
          Responsável no Jornada:{" "}
          {selectedOwner?.name ??
            (data.attendance.ownerId ? "Membro indisponível" : "Sem responsável")}
        </p>
        {data.attendance.nextAction ? (
          <>
            <p className="break-words">{data.attendance.nextAction}</p>
            <p className="text-xs">
              Prazo: {formatarDataHora(data.attendance.nextActionAt, data.timezone)}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Sem retorno interno registrado.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Seu acesso permite apenas consultar este acompanhamento.
        </p>
      </div>
    );
  return (
    <form
      className="space-y-3 border-t pt-4"
      aria-label="Acompanhamento interno"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h3 className="font-medium">Acompanhamento interno</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Responsável e retorno apenas no Jornada AI. Salvar não envia mensagens nem altera o GHL.
        </p>
      </div>
      {(remoteChanged || conflict) && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-400 p-2 text-xs">
          <p>
            {baseline.timezone !== data.timezone
              ? "O fuso deste atendimento mudou."
              : "Este acompanhamento mudou."}{" "}
            Sua edição foi mantida; confira os dados atuais antes de salvar.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || (conflict && !remoteChanged)}
            onClick={() => reset(data)}
          >
            Usar dados atuais
          </Button>
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-owner`} className="text-xs font-medium">
          Responsável no Jornada
        </label>
        <select
          id={`${id}-owner`}
          className="w-full min-w-0 rounded-md border bg-card p-2 text-sm"
          value={owner}
          disabled={blocked}
          onChange={(event) => edit(() => setOwner(event.target.value))}
        >
          <option value="">Sem responsável</option>
          {owner && !data.team.some((member) => member.id === owner) && (
            <option value={owner} disabled>
              Membro indisponível
            </option>
          )}
          {data.team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-action`} className="text-xs font-medium">
          Próxima ação interna
        </label>
        <Textarea
          id={`${id}-action`}
          rows={2}
          maxLength={500}
          value={text}
          disabled={blocked}
          onChange={(event) => edit(() => setText(event.target.value))}
          placeholder="Ex.: verificar opções de horário"
          aria-describedby={`${id}-privacy`}
        />
        <p id={`${id}-privacy`} className="text-xs text-muted-foreground">
          Use uma descrição administrativa, sem informações clínicas.
        </p>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-due`} className="text-xs font-medium">
          Prazo ({data.timezone})
        </label>
        <Input
          id={`${id}-due`}
          className="min-w-0 max-w-full"
          type="datetime-local"
          value={due}
          disabled={blocked}
          onChange={(event) => edit(() => setDue(event.target.value))}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={blocked || !dirty}>
          <Save className="size-3.5" />
          {pending ? "A salvar…" : "Salvar acompanhamento"}
        </Button>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => reset(data)}
          >
            Descartar edição
          </Button>
        )}
        {data.attendance.nextAction && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked || dirty}
            onClick={() => void submit(true)}
          >
            <Check className="size-3.5" />
            Concluir retorno
          </Button>
        )}
      </div>
      {dirty && data.attendance.nextAction && (
        <p className="text-xs text-muted-foreground">
          Salve ou descarte a edição antes de concluir o retorno.
        </p>
      )}
    </form>
  );
}
