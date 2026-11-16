import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PilotKind } from "@/lib/n8n-bridge-pilot";
import {
  PRODUCTION_KINDS,
  type ProductionKind,
  type RuntimeInput,
  type RuntimeMode,
  type RuntimeStatus,
} from "@/lib/n8n-bridge-runtime.schema";

type Mode = RuntimeMode;
export type N8nRuntimeControlState = RuntimeStatus;
type Change = RuntimeInput;
type Props = {
  authorized: boolean;
  state: N8nRuntimeControlState | null | undefined;
  calendarId: string | null;
  channel: string | null;
  zaptosProviderId: string | null;
  channelVerified: boolean;
  refreshing: boolean;
  disabled?: boolean;
  save: (change: Change) => Promise<{ ok: true; revision: number } | { ok: false; code: string }>;
  refresh: () => Promise<void>;
};
const ACTIONS: { kind: ProductionKind; label: string }[] = [
  { kind: "booking", label: "Mensagem inicial do agendamento" },
  { kind: "req24", label: "Pedido de confirmação — 24 horas antes" },
  { kind: "req12", label: "Pedido de confirmação — 12 horas antes" },
];
const productionKinds = (kinds: readonly PilotKind[] | undefined): ProductionKind[] =>
  (kinds ?? []).filter((kind): kind is ProductionKind =>
    (PRODUCTION_KINDS as readonly string[]).includes(kind),
  );
const LABELS: Record<Mode, string> = {
  off: "Envios desligados",
  pilot: "Piloto",
  production: "Produção configurada",
};
const ERRORS: Record<string, string> = {
  untrusted_origin: "Abra Integrações no endereço oficial do Jornada e atualize a sessão.",
  forbidden: "É necessário acesso administrativo à organização vinculada.",
  invalid_request: "Selecione o modo e pelo menos uma ação para ativar a produção.",
  runtime_unavailable:
    "O estado da operação não está disponível. Atualize a leitura antes de configurar.",
  revision_conflict:
    "A configuração foi alterada desde a sua leitura. Carregue a configuração atual e reveja a seleção antes de guardar.",
  configuration_changed:
    "A agenda ou o provedor mudou durante a verificação. Carregue a configuração atual antes de ativar.",
  verification_expired:
    "A verificação da agenda e do canal expirou. Tente novamente para fazer uma nova verificação.",
  clock_unavailable: "O horário do servidor não pôde ser verificado. Tente novamente mais tarde.",
  bridge_unavailable:
    "A ponte não está disponível para verificação. Confira a configuração e atualize o estado.",
  channel_not_verified:
    "O servidor não confirmou o canal atual GHL → Zaptos/WhatsApp. A produção não foi ativada.",
  calendar_not_verified:
    "O servidor não confirmou a agenda na subconta vinculada. A produção não foi ativada.",
  address_not_configured:
    "Guarde a morada da clínica antes de ativar o agradecimento da confirmação.",
  credentials_unavailable:
    "A credencial necessária não está disponível no servidor. A produção não foi ativada.",
  binding_unavailable:
    "O vínculo com a subconta GHL não pôde ser confirmado. A produção não foi ativada.",
  persist_failed: "A gravação não foi comprovada. Atualize o estado antes de repetir.",
};

/** Explicit administrative controls. Rendering and refreshing never authorize live operations. */
export function N8nRuntimeControl({
  authorized,
  state,
  calendarId,
  channel,
  zaptosProviderId,
  channelVerified,
  refreshing,
  disabled = false,
  save,
  refresh,
}: Props) {
  const [mode, setMode] = useState<Mode>(state?.mode ?? "off");
  const [kinds, setKinds] = useState<ProductionKind[]>(productionKinds(state?.allowedKinds));
  const [revision, setRevision] = useState(state?.revision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (dirty) return;
    setMode(state?.mode ?? "off");
    setKinds(productionKinds(state?.allowedKinds));
    setRevision(state?.revision ?? 0);
  }, [state, dirty]);
  if (!authorized) return null;
  const unavailable = !state?.available;
  const busy = pending || refreshing || disabled;
  const stale = dirty && state?.revision !== revision;
  const cannotSave = busy || unavailable || reloadRequired || stale;
  const changedConfiguration =
    state?.available && state.mode === "production"
      ? [
          state.calendarId !== calendarId && "agenda",
          state.channel !== channel && "canal",
          state.zaptosProviderId !== zaptosProviderId && "provedor",
        ].filter(Boolean)
      : [];
  const needsVerification =
    state?.available &&
    state.mode === "production" &&
    (changedConfiguration.length > 0 || !channelVerified);
  const reactivating = mode === "production" && state?.mode === "production";

  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setResult(null);
    try {
      await refresh();
      setDirty(false);
      setReloadRequired(false);
    } catch {
      setResult({
        ok: false,
        message: "Não foi possível atualizar o estado. Tente novamente antes de guardar.",
      });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  async function submit(target: Mode) {
    if (lock.current || cannotSave) return;
    if (target === "production" && !kinds.length) {
      setResult({ ok: false, message: ERRORS["invalid_request"]! });
      return;
    }
    lock.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = await save({
        mode: target,
        expectedRevision: revision,
        allowedKinds: target === "production" ? kinds : [],
      });
      if (!response.ok) {
        setResult({
          ok: false,
          message:
            ERRORS[response.code] ??
            "Não foi possível concluir a operação. Atualize o estado antes de repetir.",
        });
        if (
          ["revision_conflict", "configuration_changed", "persist_failed"].includes(response.code)
        ) {
          setReloadRequired(true);
        }
        return;
      }
      // Success is shown only after the persisted state has been read again.
      await refresh();
      setDirty(false);
      setResult({
        ok: true,
        message:
          target === "off"
            ? "Desativação guardada. Confira o estado lido do servidor acima."
            : target === "pilot"
              ? "Modo piloto guardado, com simulação e envio real desligado. A autorização do agendamento é configurada abaixo."
              : "Configuração de produção guardada. A entrega e a resposta dos pacientes ainda precisam ser comprovadas nos registros de execução.",
      });
    } catch {
      setReloadRequired(true);
      setResult({
        ok: false,
        message:
          "Não foi possível comprovar o estado final. Carregue a configuração atual antes de repetir.",
      });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(mode);
  }
  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-labelledby="n8n-runtime-title"
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="n8n-runtime-title" className="font-medium">
          Operação da automação
        </h3>
        <Badge
          variant={
            state?.available && state.mode === "production" && !needsVerification
              ? "default"
              : "outline"
          }
        >
          {needsVerification
            ? "Produção precisa de revisão"
            : state?.available
              ? LABELS[state.mode]
              : "Estado indisponível"}
        </Badge>
      </div>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline text-muted-foreground">Canal atual: </dt>
          <dd className="inline">
            {channel === "whatsapp_zaptos"
              ? "GHL → Zaptos/WhatsApp"
              : "Por verificar na configuração"}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Agenda configurada: </dt>
          <dd className="inline break-all">{calendarId ?? "Por definir"}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Produção para agendamento e pedidos de confirmação. A confirmação após a resposta continua
        supervisionada. Apenas as ações selecionadas podem funcionar continuamente na agenda
        vinculada; cada execução confere o contato, os bloqueios e os registros para evitar
        duplicações.
      </p>
      {state?.available && (
        <p className="text-xs text-muted-foreground">
          Configuração lida do servidor · revisão {state.revision}
          {state.updatedAt ? ` · ${state.updatedAt}` : ""}
        </p>
      )}
      {state?.available && state.mode === "production" && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            Ações guardadas:{" "}
            {ACTIONS.filter(({ kind }) => state.allowedKinds.includes(kind))
              .map(({ label }) => label)
              .join("; ") || "Nenhuma"}
            .
          </p>
          {state.verifiedAt && (
            <p>
              Agenda e canal verificados no servidor em {state.verifiedAt}. Isso não comprova
              entrega.
            </p>
          )}
        </div>
      )}
      {unavailable && (
        <p role="alert" className="text-sm text-destructive">
          O estado da operação não foi verificado. Atualize a leitura antes de configurar.
        </p>
      )}
      {needsVerification && (
        <p role="alert" className="text-sm text-destructive">
          {changedConfiguration.length > 0
            ? `Configuração alterada: ${changedConfiguration.join(", ")}.`
            : "O canal deixou de estar verificado."}{" "}
          Os envios ficam bloqueados até verificar e reativar a produção com a configuração atual.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset disabled={busy || unavailable} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="n8n-runtime-mode">Modo desejado</Label>
            <select
              id="n8n-runtime-mode"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={mode}
              onChange={(event) => {
                setDirty(true);
                setResult(null);
                setMode(event.target.value as Mode);
              }}
            >
              <option value="off">Desligado</option>
              <option value="pilot">Piloto de um agendamento</option>
              <option value="production">Produção contínua</option>
            </select>
          </div>
          {mode === "production" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Ações permitidas em produção</legend>
              {ACTIONS.map(({ kind, label }) => (
                <label key={kind} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={kinds.includes(kind)}
                    onChange={(event) => {
                      setDirty(true);
                      setResult(null);
                      setKinds(
                        event.target.checked
                          ? [...kinds, kind]
                          : kinds.filter((value) => value !== kind),
                      );
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                Ao ativar, o servidor verifica a agenda e o canal atual, desliga a simulação e
                habilita o envio real. Este botão não executa uma mensagem de teste.
              </p>
            </fieldset>
          )}
          {mode === "pilot" && (
            <p className="text-sm text-muted-foreground">
              O piloto mantém um único contato e compromisso autorizados. Mudar para este modo
              desliga os envios reais e volta à simulação.
            </p>
          )}
          {mode === "off" && (
            <p className="text-sm text-muted-foreground">
              Desliga novas ações reais da ponte. Uma solicitação já aceita pelo provedor não pode
              ser cancelada aqui.
            </p>
          )}
          <Button type="submit" size="sm" disabled={cannotSave}>
            {pending
              ? "A verificar…"
              : mode === "production"
                ? reactivating
                  ? "Verificar e reativar produção"
                  : "Verificar e ativar produção"
                : mode === "pilot"
                  ? "Guardar modo piloto"
                  : "Desligar envios"}
          </Button>
        </fieldset>
      </form>
      {(stale || reloadRequired) && (
        <p className="text-sm text-muted-foreground">
          Carregue a configuração atual para continuar. A seleção ainda não guardada será
          substituída.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {mode !== "off" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cannotSave}
            onClick={() => void submit("off")}
          >
            Desligar envios
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void reload()}
        >
          {stale || reloadRequired || dirty
            ? "Carregar configuração atual"
            : "Atualizar estado da operação"}
        </Button>
      </div>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-sm text-success" : "text-sm text-destructive"}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
