import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { chaveDia, formatarDataHora } from "@/lib/clinic-time";
import {
  getChatBookingOptions,
  createChatBooking,
  readChatBookingRequest,
  abandonChatBookingRequest,
} from "@/lib/chat-booking.functions";
import type { ChatBookingOptions, ChatBookingReceipt } from "@/lib/chat-booking.core";

export type InboxBookingPanelProps = {
  organizationId: string;
  contactId: string;
  contactName: string;
  scope: string;
  timeZone: string;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageKey = (scope: string, org: string, contact: string) =>
  `jornada:chat-booking:${JSON.stringify([scope, org, contact])}:`;
function readPending(key: string): { requestId: string | null; unavailable: boolean } {
  try {
    const pending: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const entry = localStorage.key(index);
      if (!entry?.startsWith(key)) continue;
      const id = entry.slice(key.length);
      if (!UUID.test(id) || localStorage.getItem(entry) !== id)
        return { requestId: null, unavailable: true };
      pending.push(id);
    }
    return { requestId: pending.sort()[0] ?? null, unavailable: false };
  } catch {
    return { requestId: null, unavailable: true };
  }
}
function recovered(requestId: string): ChatBookingReceipt {
  return {
    requestId,
    state: "unknown",
    message:
      "Existe um pedido de agendamento a conferir. Verifique o resultado antes de criar outro.",
  };
}
function slotsMatchRequestedDay(data: ChatBookingOptions, date: string) {
  try {
    return data.slots.every((slot) => {
      const start = Date.parse(slot.startAt);
      const end = Date.parse(slot.endAt);
      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        chaveDia(slot.startAt, data.timezone) === date
      );
    });
  } catch {
    return false;
  }
}

/** Keeps recovery metadata isolated by owner, organization and existing GHL contact. */
export function InboxBookingPanel(props: InboxBookingPanelProps) {
  return (
    <BookingWorkspace
      key={JSON.stringify([props.scope, props.organizationId, props.contactId])}
      {...props}
    />
  );
}
function BookingWorkspace(props: InboxBookingPanelProps) {
  const getOptions = useServerFn(getChatBookingOptions);
  const create = useServerFn(createChatBooking);
  const read = useServerFn(readChatBookingRequest);
  const abandon = useServerFn(abandonChatBookingRequest);
  const queryClient = useQueryClient();
  const key = storageKey(props.scope, props.organizationId, props.contactId);
  const [initial] = useState(() => readPending(key));
  const [receipt, setReceipt] = useState<ChatBookingReceipt | null>(() =>
    initial.requestId ? recovered(initial.requestId) : null,
  );
  const [storageBlocked, setStorageBlocked] = useState(initial.unavailable);
  const [date, setDate] = useState(() => chaveDia(new Date(), props.timeZone));
  const [options, setOptions] = useState<{ date: string; data: ChatBookingOptions } | null>(null);
  const [selected, setSelected] = useState("");
  const [notify, setNotify] = useState(false);
  const [review, setReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingRequestId, setMissingRequestId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  const live = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  const unresolved = receipt?.state === "unknown" || receipt?.state === "pending";
  const terminal = receipt?.state === "confirmed" || receipt?.state === "rejected";
  const scope = { organizationId: props.organizationId, ghlContactId: props.contactId };
  useEffect(() => {
    live.current = true;
    const pending = readPending(key);
    setStorageBlocked(pending.unavailable);
    if (pending.requestId) setReceipt(recovered(pending.requestId));
    return () => {
      live.current = false;
    };
  }, [key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(key)) return;
      const pending = readPending(key);
      if (pending.unavailable) setStorageBlocked(true);
      if (pending.requestId && !busy.current) {
        setReceipt(recovered(pending.requestId));
        setReview(false);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  useEffect(() => {
    if (!props.open || unresolved || terminal || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let active = true;
    setLoading(true);
    setError(null);
    setOptions(null);
    setSelected("");
    setReview(false);
    void getOptions({ data: { ...scope, date } })
      .then((result) => {
        if (!active) return;
        if (!result.ok) setError(result.message);
        else if (!slotsMatchRequestedDay(result.data, date))
          setError(
            "Os horários recebidos não correspondem à data consultada. Consulte novamente antes de agendar.",
          );
        else setOptions({ date, data: result.data });
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível consultar os horários. Tente novamente; nenhum agendamento foi criado.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Functions are server handles; scope is fixed by the keyed workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.timeZone, date, refresh, unresolved, terminal]);
  function clearPending(requestId: string) {
    try {
      const current = localStorage.getItem(key + requestId);
      if (current !== null && current !== requestId) throw new Error("pending_marker_mismatch");
      if (current === requestId) localStorage.removeItem(key + requestId);
      if (localStorage.getItem(key + requestId) === requestId)
        throw new Error("pending_marker_retained");
      setStorageBlocked(false);
      return true;
    } catch {
      setStorageBlocked(true);
      return false;
    }
  }
  async function acceptReceipt(value: ChatBookingReceipt) {
    if (live.current) {
      setMissingRequestId(null);
      setReceipt(value);
    }
    if (value.state !== "confirmed" && value.state !== "rejected") return;
    if (live.current && (value.state === "rejected" || value.cacheSynced !== false))
      clearPending(value.requestId);
    if (value.state === "confirmed") {
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: ["attendance-context", props.scope, props.organizationId, props.contactId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["attendance-workspace", props.scope, props.organizationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["marcacoes", props.scope, props.organizationId],
        }),
      ]);
      if (live.current) props.onConfirmed();
    }
  }
  const data = options?.date === date ? options.data : null;
  const slot = data?.slots.find((item) => item.startAt === selected) ?? null;
  const canCreate = Boolean(
    review &&
    data?.canBook &&
    slot &&
    !loading &&
    !working &&
    !props.disabled &&
    !storageBlocked &&
    !unresolved &&
    !terminal,
  );
  async function submit() {
    if (busy.current || !canCreate || !data || !slot) return;
    const previous = readPending(key);
    if (previous.unavailable) {
      setStorageBlocked(true);
      return;
    }
    if (previous.requestId) {
      setReceipt(recovered(previous.requestId));
      setReview(false);
      return;
    }
    let requestId: string;
    // Persist before the first POST; reload is a read of this UUID, never a new attempt.
    try {
      requestId = crypto.randomUUID();
      localStorage.setItem(key + requestId, requestId);
      if (localStorage.getItem(key + requestId) !== requestId)
        throw new Error("pending_marker_not_saved");
    } catch {
      setStorageBlocked(true);
      return;
    }
    busy.current = true;
    setWorking(true);
    setError(null);
    setReceipt({
      requestId,
      state: "pending",
      message: "A criar o agendamento. Aguarde a confirmação do GHL.",
    });
    try {
      const response = await create({
        data: {
          ...scope,
          requestId,
          calendarId: data.calendarId,
          timezone: data.timezone,
          startAt: slot.startAt,
          endAt: slot.endAt,
          notify,
        },
      });
      if (!live.current) return;
      if (response.ok) await acceptReceipt(response.data);
      else {
        // The server contract guarantees ok:false occurs before provider dispatch.
        clearPending(requestId);
        setReceipt({ requestId, state: "rejected", message: response.message });
        setReview(false);
        setSelected("");
        setOptions(null);
      }
    } catch {
      if (live.current)
        setReceipt({
          requestId,
          state: "unknown",
          message:
            "O resultado ainda não foi confirmado. Não crie outro pedido: verifique o resultado deste agendamento.",
        });
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  }
  async function reconcile() {
    if (!receipt || busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const response = await read({ data: { ...scope, requestId: receipt.requestId } });
      if (!live.current) return;
      if (response.ok) await acceptReceipt(response.data);
      else {
        setError(response.message);
        setMissingRequestId(response.code === "not_found" ? receipt.requestId : null);
      }
    } catch {
      if (live.current)
        setError(
          "Não foi possível conferir agora. O pedido foi preservado; tente verificar novamente.",
        );
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  }
  async function abandonMissing() {
    if (!receipt || missingRequestId !== receipt.requestId || busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const response = await abandon({ data: { ...scope, requestId: receipt.requestId } });
      if (!live.current) return;
      if (!response.ok) setError(response.message);
      else if (!response.data.abandoned) await acceptReceipt(response.data.receipt);
      else {
        clearPending(receipt.requestId);
        setMissingRequestId(null);
        setReceipt({
          requestId: receipt.requestId,
          state: "rejected",
          message: "Pedido encerrado sem criar agendamento. Pode escolher outro horário.",
        });
      }
    } catch {
      if (live.current)
        setError(
          "Não foi possível encerrar o pedido com segurança. A referência foi preservada; tente verificar o resultado.",
        );
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  }
  function startAnother() {
    if (storageBlocked || unresolved || working) return;
    const pending = readPending(key);
    if (pending.unavailable) {
      setStorageBlocked(true);
      return;
    }
    if (pending.requestId) {
      setReceipt(recovered(pending.requestId));
      return;
    }
    setReceipt(null);
    setSelected("");
    setNotify(false);
    setReview(false);
    setError(null);
    setRefresh((value) => value + 1);
  }
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md motion-reduce:animate-none motion-reduce:transition-none"
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 pb-4 pt-4 pr-10 text-left">
          <SheetClose asChild>
            <Button variant="ghost" size="sm" className="min-h-11 self-start px-0">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Voltar à conversa
            </Button>
          </SheetClose>
          <SheetTitle>Agendar agora</SheetTitle>
          <SheetDescription>
            Para{" "}
            <span className="font-medium text-foreground">
              {data?.contactName ?? props.contactName}
            </span>
            , no cadastro existente do GHL. Seu rascunho permanece na conversa.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5">
          {storageBlocked && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>
                Não foi possível guardar ou recuperar a referência deste pedido neste navegador. A
                criação está bloqueada para evitar duplicações.
              </p>
              {receipt && (
                <Button variant="outline" disabled={working} onClick={() => void reconcile()}>
                  Verificar resultado
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {receipt ? (
            <div className="space-y-4" aria-live="polite">
              <p role="status" className="text-sm font-medium">
                {receipt.message}
              </p>
              {receipt.state === "confirmed" && (
                <>
                  <dl className="space-y-2 text-sm">
                    {receipt.calendarName && (
                      <div>
                        <dt className="text-muted-foreground">Calendário</dt>
                        <dd>{receipt.calendarName}</dd>
                      </div>
                    )}
                    {receipt.startAt && (
                      <div>
                        <dt className="text-muted-foreground">Consulta</dt>
                        <dd>
                          {formatarDataHora(receipt.startAt, receipt.timezone ?? props.timeZone)} (
                          {receipt.timezone ?? props.timeZone})
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    O agendamento não comprova a confirmação de presença do paciente.
                  </p>
                  {receipt.cacheSynced === false && (
                    <p role="status" className="text-sm">
                      Criado no GHL. A atualização da agenda no Jornada AI está pendente.
                    </p>
                  )}
                </>
              )}
              {(unresolved || (receipt.state === "confirmed" && receipt.cacheSynced === false)) && (
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  disabled={working}
                  onClick={() => void reconcile()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {working
                    ? "A conferir…"
                    : receipt.state === "confirmed"
                      ? "Atualizar agenda"
                      : "Verificar resultado"}
                </Button>
              )}
              {unresolved && missingRequestId === receipt.requestId && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="min-h-11 w-full"
                    disabled={working}
                    onClick={() => void abandonMissing()}
                  >
                    Encerrar pedido sem registro
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Encerra apenas uma tentativa que não chegou a ser registrada. Não cancela
                    consultas existentes. Se a criação já tiver começado, o resultado será
                    conferido.
                  </p>
                </div>
              )}
              {terminal && !storageBlocked && (
                <Button variant="outline" className="min-h-11 w-full" onClick={startAnother}>
                  {receipt.state === "rejected"
                    ? "Escolher outro horário"
                    : "Preparar outro agendamento"}
                </Button>
              )}
            </div>
          ) : review && data && slot ? (
            <div className="space-y-4">
              <h3 className="font-semibold">Confira antes de criar</h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Contato</dt>
                  <dd>{data.contactName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Calendário</dt>
                  <dd>{data.calendarName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Data e horário</dt>
                  <dd>
                    {formatarDataHora(slot.startAt, data.timezone)} · {data.durationMinutes} min
                  </dd>
                  <dd className="text-xs text-muted-foreground">Horário de {data.timezone}</dd>
                </div>
                {data.meetingLabel && (
                  <div>
                    <dt className="text-muted-foreground">Local</dt>
                    <dd>{data.meetingLabel}</dd>
                  </div>
                )}
              </dl>
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={notify}
                    onChange={(event) => setNotify(event.target.checked)}
                  />
                  <span>Acionar confirmações e lembretes do calendário</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Marcar permite as notificações configuradas no GHL para este compromisso. Nenhuma
                  mensagem é escrita ou enviada pelo Meu Chat nesta ação.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Ao criar, o compromisso será registrado no GHL. Workflows associados podem reagir à
                criação conforme a configuração da clínica.
              </p>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => setReview(false)}
              >
                Voltar aos horários
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor="chat-booking-date" className="text-sm font-medium">
                  Data da consulta
                </label>
                <Input
                  id="chat-booking-date"
                  type="date"
                  min={chaveDia(new Date(), props.timeZone)}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setSelected("");
                    setReview(false);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Horários em {data?.timezone ?? props.timeZone}.
                </p>
              </div>
              {loading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  A consultar horários reais no GHL…
                </p>
              ) : data ? (
                <>
                  <div className="space-y-1">
                    <h3 className="font-medium">{data.calendarName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {data.durationMinutes} minutos
                      {data.meetingLabel ? ` · ${data.meetingLabel}` : ""}
                    </p>
                  </div>
                  {!data.canBook && (
                    <p role="status" className="text-sm">
                      {data.blockReason ??
                        "O seu acesso permite consultar; a criação ainda não está disponível."}
                    </p>
                  )}
                  {data.slots.length ? (
                    <fieldset className="space-y-2">
                      <legend className="pb-2 text-sm font-medium">Horários disponíveis</legend>
                      <div className="grid grid-cols-3 gap-2">
                        {data.slots.map((item) => (
                          <label
                            key={item.startAt}
                            className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm ${selected === item.startAt ? "border-primary bg-accent text-accent-foreground" : "border-input bg-background"}`}
                          >
                            <input
                              type="radio"
                              name="chat-booking-slot"
                              value={item.startAt}
                              checked={selected === item.startAt}
                              disabled={!data.canBook || props.disabled}
                              onChange={() => setSelected(item.startAt)}
                              className="accent-primary"
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      Nenhum horário disponível nesta data. Escolha outro dia.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Disponibilidade consultada em {formatarDataHora(data.checkedAt, data.timezone)}.
                    O horário será conferido novamente ao criar.
                  </p>
                </>
              ) : (
                !loading && (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    Tentar consultar novamente
                  </Button>
                )
              )}
            </>
          )}
        </div>
        <div className="shrink-0 border-t border-border p-4">
          {!receipt &&
            (review ? (
              <Button
                className="min-h-11 w-full"
                disabled={!canCreate}
                onClick={() => void submit()}
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                Criar agendamento
              </Button>
            ) : (
              <Button
                className="min-h-11 w-full"
                disabled={!slot || !data?.canBook || loading || props.disabled || storageBlocked}
                onClick={() => setReview(true)}
              >
                Revisar agendamento
              </Button>
            ))}
          {receipt && (
            <SheetClose asChild>
              <Button variant="outline" className="min-h-11 w-full">
                Voltar ao atendimento
              </Button>
            </SheetClose>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
