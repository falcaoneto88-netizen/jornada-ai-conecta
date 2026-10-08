import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guardarPilotoN8n } from "@/lib/n8n-bridge.functions";
import { pilotInputSchema } from "@/lib/n8n-bridge-pilot.schema";
import type { PilotKind, PilotStatus } from "@/lib/n8n-bridge-pilot";
import type { EstadoPonteN8n } from "@/lib/n8n-bridge.admin.server";

const ACTIONS: { kind: PilotKind; label: string }[] = [
  { kind: "booking", label: "Mensagem inicial (booking)" },
  { kind: "req24", label: "Solicitar confirmação — 24h (req24)" },
  { kind: "req12", label: "Solicitar confirmação — 12h (req12)" },
  { kind: "appointment.confirm", label: "Confirmar compromisso após SIM (appointment.confirm)" },
  { kind: "confirm", label: "Agradecer confirmação comprovada (confirm)" },
];
const ERRORS: Record<string, string> = {
  forbidden: "A sessão precisa de acesso administrativo à organização vinculada.",
  untrusted_origin: "Abra Integrações no endereço oficial do projeto e atualize a sessão.",
  invalid_request: "Confira IDs, datas com fuso e pelo menos uma ação permitida.",
  invalid_window:
    "A expiração deve ser futura, em até 24 horas e não passar do início da consulta.",
  contact_not_verified: "O contato não foi confirmado na subconta vinculada.",
  contact_preferences_not_verified:
    "O contato foi localizado na subconta correta, mas o GHL não retornou preferências de bloqueio (DND) verificáveis. A autorização não foi guardada. Confira essas preferências no GHL antes de repetir.",
  appointment_not_verified:
    "O compromisso não corresponde ao contato, agenda, início ou estado esperado no GHL.",
  bridge_unavailable: "A agenda da ponte não está disponível para verificação.",
  pilot_unavailable:
    "A configuração do piloto não pôde ser lida. Confira a migração e atualize o estado.",
  persist_failed: "A gravação não foi comprovada. Atualize o estado antes de repetir.",
};
const LABELS = {
  off: "Sem autorização ativa",
  active: "Autorização ativa",
  expired: "Autorização expirada",
  unavailable: "Estado indisponível",
};

const UNKNOWN_PILOT: PilotStatus = {
  status: "unavailable",
  contactId: null,
  appointmentId: null,
  expectedStartTime: null,
  expiresAt: null,
  allowedKinds: [],
};

type Props = { state: EstadoPonteN8n; refreshing: boolean; refresh: () => Promise<void> };
export function N8nPilotControl({ state, refreshing, refresh }: Props) {
  const save = useServerFn(guardarPilotoN8n);
  const [contact, setContact] = useState("");
  const [appointment, setAppointment] = useState("");
  const [start, setStart] = useState("");
  const [expiry, setExpiry] = useState("");
  const [kinds, setKinds] = useState<PilotKind[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const pilot = state.pilot ?? UNKNOWN_PILOT;
  // Refresh persisted evidence without overwriting a form currently being edited.
  useEffect(() => {
    if (dirty) return;
    setContact(pilot.contactId ?? "");
    setAppointment(pilot.appointmentId ?? "");
    setStart(pilot.expectedStartTime ?? "");
    setExpiry(pilot.expiresAt ?? "");
    setKinds(pilot.allowedKinds);
  }, [pilot, dirty]);
  if (!state.autorizado) return null;
  const unavailable = pilot.status === "unavailable" || !state.bindingOk;
  const blocked = [
    !state.bridgeEnabled && "ponte desligada",
    !state.bindingOk && "vínculo GHL não confirmado",
    !state.writeEnabled && "escrita GHL desativada",
    state.simulation && "modo de simulação",
    !state.liveSendEnabled && "envio real desligado",
    !state.calendarId && "agenda indefinida",
    (!state.channel || !state.channelVerified) && "canal não verificado",
    !state.clinicAddress.trim() && "morada indefinida",
  ].filter(Boolean);
  const update = (setter: (v: string) => void, value: string) => {
    setDirty(true);
    setResult(null);
    setter(value);
  };
  async function submit(revoke: boolean) {
    const parsed = pilotInputSchema.safeParse(
      revoke
        ? { enabled: false }
        : {
            enabled: true,
            contactId: contact.trim(),
            appointmentId: appointment.trim(),
            expectedStartTime: start.trim(),
            expiresAt: expiry.trim(),
            allowedKinds: kinds,
          },
    );
    if (!parsed.success) {
      setResult({ ok: false, message: ERRORS["invalid_request"]! });
      return;
    }
    setPending(true);
    setResult(null);
    try {
      const r = await save({ data: parsed.data });
      if (!r.ok) {
        setResult({
          ok: false,
          message:
            ERRORS[r.code] ?? "Não foi possível comprovar a configuração. Atualize o estado.",
        });
        return;
      }
      await refresh();
      setDirty(false);
      setResult({
        ok: true,
        message: revoke
          ? "Revogação guardada. Confira a leitura do servidor acima."
          : "Autorização guardada. Confira a leitura do servidor acima; as flags de envio permanecem como estavam.",
      });
    } catch {
      setResult({
        ok: false,
        message: "Não foi possível concluir a operação. Atualize o estado antes de repetir.",
      });
    } finally {
      setPending(false);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }
  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="n8n-pilot-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="n8n-pilot-title" className="font-medium">
          Piloto de um agendamento
        </h3>
        <Badge variant={pilot.status === "active" ? "default" : "outline"}>
          {LABELS[pilot.status]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Autorize somente o contato e o compromisso do teste. Guardar ou revogar não altera
        simulação, canal ou ativação de envios.
      </p>
      {state.pilotCheckedAt && (
        <p className="text-xs text-muted-foreground">
          Última leitura do servidor: {state.pilotCheckedAt}
        </p>
      )}
      {pilot.contactId && (
        <dl className="grid gap-1 text-xs break-all">
          <div>
            <dt className="inline font-medium">Contato autorizado: </dt>
            <dd className="inline">{pilot.contactId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Compromisso autorizado: </dt>
            <dd className="inline">{pilot.appointmentId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Início autorizado: </dt>
            <dd className="inline">{pilot.expectedStartTime}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Expira em: </dt>
            <dd className="inline">{pilot.expiresAt}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Ações autorizadas: </dt>
            <dd className="inline">{pilot.allowedKinds.join(", ")}</dd>
          </div>
        </dl>
      )}
      {blocked.length > 0 && (
        <p className="text-sm text-muted-foreground">Bloqueios para envio: {blocked.join("; ")}.</p>
      )}
      {unavailable && (
        <p role="alert" className="text-sm text-destructive">
          Verifique a leitura do piloto e o vínculo GHL antes de configurar. Nenhuma autorização foi
          presumida.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset disabled={pending || unavailable} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pilot-contact">ID exato do contato de teste</Label>
              <Input
                id="pilot-contact"
                autoComplete="off"
                value={contact}
                onChange={(e) => update(setContact, e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pilot-appointment">ID exato do compromisso</Label>
              <Input
                id="pilot-appointment"
                autoComplete="off"
                value={appointment}
                onChange={(e) => update(setAppointment, e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pilot-start">Início da consulta (ISO com fuso)</Label>
              <Input
                id="pilot-start"
                autoComplete="off"
                value={start}
                onChange={(e) => update(setStart, e.target.value)}
                placeholder="AAAA-MM-DDTHH:mm:ss+01:00"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pilot-expiry">Expiração (ISO com fuso)</Label>
              <Input
                id="pilot-expiry"
                autoComplete="off"
                value={expiry}
                onChange={(e) => update(setExpiry, e.target.value)}
                placeholder="AAAA-MM-DDTHH:mm:ss+01:00"
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Use o instante exato do compromisso, incluindo Z ou o offset do fuso. Expiração em até
            24 horas, antes ou no início da consulta. O servidor confere o horário no GHL.
          </p>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Ações permitidas neste teste</legend>
            {ACTIONS.map(({ kind, label }) => (
              <label key={kind} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={kinds.includes(kind)}
                  onChange={(e) => {
                    setDirty(true);
                    setResult(null);
                    setKinds(e.target.checked ? [...kinds, kind] : kinds.filter((v) => v !== kind));
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" size="sm" disabled={pending || refreshing}>
            {pending ? "A guardar…" : "Guardar autorização do piloto"}
          </Button>
        </fieldset>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || refreshing || unavailable || pilot.status === "off"}
          onClick={() => void submit(true)}
        >
          Revogar autorização
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || refreshing}
          onClick={() => void refresh()}
        >
          Atualizar estado do piloto
        </Button>
      </div>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
