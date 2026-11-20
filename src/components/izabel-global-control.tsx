import { useServerFn } from "@tanstack/react-start";
import { Bot, LoaderCircle, Pause, Power } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getIzabelAutomation,
  setIzabelAutomation,
} from "@/lib/commercial-agent-automation.functions";
import type { AutomationState } from "@/lib/commercial-agent/automation";

const ERRORS: Record<string, string> = {
  forbidden: "Somente administradores e gestores podem alterar o atendimento automático.",
  version_conflict:
    "Outra pessoa alterou esta configuração. O estado atual foi solicitado; confira-o antes de tentar novamente.",
  revision_conflict:
    "Outra pessoa alterou esta configuração. O estado atual foi solicitado; confira-o antes de tentar novamente.",
  configuration_changed:
    "A configuração mudou durante a verificação. Atualize o estado antes de ativar.",
  policy_changed: "A base da Izabel mudou. É necessário verificar a nova versão antes de ativar.",
  automation_policy_changed:
    "A base da Izabel mudou. É necessário verificar a nova versão antes de ativar.",
  policy_not_current:
    "A base aprovada da Izabel precisa ser verificada antes de ativar o atendimento automático.",
  disabled: "O atendimento automático ainda não está habilitado no servidor.",
  automation_not_configured:
    "O atendimento automático ainda precisa ser preparado no servidor. A ativação está indisponível.",
  automation_receipt_required:
    "O recebimento das novas mensagens da clínica precisa estar configurado antes da ativação.",
  send_disabled: "O envio da Izabel ainda não está habilitado no servidor.",
  binding_unavailable: "A ligação desta clínica ao GHL precisa ser verificada.",
  write_disabled: "A ligação ao GHL não está habilitada para envio.",
  channel_not_verified: "O canal de envio precisa ser verificado antes da ativação.",
  no_channels: "Não há um canal autorizado para o atendimento automático.",
  unsupported_channel: "O canal atual não está autorizado para respostas automáticas.",
  scope_mismatch:
    "Não foi possível confirmar a clínica e a subconta deste atendimento. Atualize a sessão.",
  storage_unavailable:
    "O registro do atendimento automático está indisponível. Atualize o estado antes de continuar.",
  knowledge_unavailable: "A base aprovada da Izabel não está disponível para verificação.",
  persist_failed:
    "Não foi possível confirmar a gravação. Atualize o estado antes de repetir a ação.",
};
const errorMessage = (code: string) =>
  ERRORS[code] ?? "Não foi possível confirmar esta operação. Atualize o estado e tente novamente.";
const channelLabel = (channel: string) =>
  ({
    SMS: "Canal SMS do GHL",
    WhatsApp: "WhatsApp pelo GHL",
    IG: "Instagram pelo GHL",
    FB: "Facebook pelo GHL",
  })[channel] ?? "Canal autorizado pelo GHL";

async function withReadDeadline<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("read_timeout")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** A fresh organization mounts a fresh controller; it cannot reuse another tenant's state. */
export function IzabelGlobalControl({ organizationId }: { organizationId: string }) {
  return <ConnectedControl key={organizationId} organizationId={organizationId} />;
}

function ConnectedControl({ organizationId }: { organizationId: string }) {
  const read = useServerFn(getIzabelAutomation);
  const save = useServerFn(setIzabelAutomation);
  const titleId = useId();
  const [state, setState] = useState<AutomationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmation, setConfirmation] = useState<AutomationState | null>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const confirmationOpen = useRef(false);
  const section = useRef<HTMLElement>(null);
  const activationButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await withReadDeadline(read({ data: { organizationId } }));
      if (!mounted.current || request !== generation.current) return;
      if (!response.ok) throw new Error(response.code);
      setState(response.data);
      setReadError(false);
    } catch {
      if (!mounted.current || request !== generation.current) return;
      setReadError(true);
      setNotice("");
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [organizationId, read]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busy.current && !confirmationOpen.current)
        void refresh();
    }, 30_000);
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearInterval(timer);
    };
  }, [refresh]);

  function closeConfirmation() {
    confirmationOpen.current = false;
    setConfirmation(null);
  }

  async function change(enabled: boolean, expectedVersion: number) {
    if (busy.current || !state?.canManage) return;
    busy.current = true;
    generation.current += 1;
    setLoading(false);
    setPending(true);
    setActionError("");
    setNotice("");
    closeConfirmation();
    try {
      const response = await save({ data: { organizationId, enabled, expectedVersion } });
      if (!mounted.current) return;
      if (!response.ok) {
        setActionError(errorMessage(response.code));
        if (response.code === "persist_failed") setReadError(true);
        if (["version_conflict", "revision_conflict"].includes(response.code)) await refresh();
        return;
      }
      setState(response.data);
      setReadError(false);
      setNotice(
        response.data.enabled
          ? "Ativação registrada para as novas mensagens elegíveis."
          : "Pausa registrada. Novos envios automáticos estão desligados; um envio já aceito pelo canal não pode ser cancelado aqui.",
      );
    } catch {
      if (!mounted.current) return;
      setReadError(true);
      setActionError(
        "O resultado da alteração não foi confirmado. Atualize o estado antes de repetir.",
      );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const activationBlock = state?.activationBlock
    ? errorMessage(state.activationBlock)
    : state && !state.policyCurrent
      ? ERRORS["policy_not_current"]
      : state && state.channels.length === 0
        ? ERRORS["no_channels"]
        : null;
  const unavailable = !state || readError;
  const title = unavailable
    ? "Estado da Izabel por verificar"
    : state.enabled
      ? activationBlock
        ? "Izabel ativada · ação necessária"
        : "Izabel automática ativada no Meu Chat"
      : "Izabel automática desligada";

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-busy={loading || pending}
      className="shrink-0 space-y-2 rounded-xl border border-border bg-background px-3 py-3 sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          {loading || pending ? (
            <LoaderCircle
              className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <Bot className="size-4 shrink-0 text-primary" aria-hidden />
          )}
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state?.canManage && state.enabled && !state.policyCurrent && (
            <Button
              ref={activationButton}
              type="button"
              size="sm"
              className="min-h-10"
              disabled={
                pending ||
                loading ||
                unavailable ||
                Boolean(state.activationBlock) ||
                state.channels.length === 0
              }
              onClick={() => {
                setActionError("");
                setNotice("");
                confirmationOpen.current = true;
                setConfirmation(state);
              }}
            >
              Revalidar versão da Izabel
            </Button>
          )}
          {state?.canManage &&
            (state.enabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={pending}
                onClick={() => void change(false, state.version)}
              >
                <Pause className="size-4" aria-hidden />
                {pending ? "A guardar pausa…" : "Pausar em todo o chat"}
              </Button>
            ) : (
              <Button
                ref={activationButton}
                type="button"
                size="sm"
                className="min-h-10"
                disabled={pending || loading || unavailable || Boolean(activationBlock)}
                onClick={() => {
                  setActionError("");
                  setNotice("");
                  confirmationOpen.current = true;
                  setConfirmation(state);
                }}
              >
                <Power className="size-4" aria-hidden />
                {pending ? "A guardar ativação…" : "Ativar em todo o Meu Chat"}
              </Button>
            ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10"
            disabled={loading || pending}
            onClick={() => {
              setActionError("");
              void refresh();
            }}
          >
            Atualizar estado
          </Button>
        </div>
      </div>
      {!unavailable && (
        <p className="text-xs text-muted-foreground">
          {state.enabled
            ? "Novas mensagens elegíveis de toda a clínica. Atendimentos assumidos pela equipe permanecem pausados."
            : "A equipe continua no controle dos envios. Ative para a Izabel responder às novas mensagens elegíveis de toda a clínica."}
          {!state.canManage &&
            " A ativação e a pausa global são reservadas a administradores e gestores."}
        </p>
      )}
      {readError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível consultar o estado atual. Atualize a leitura; a indicação anterior não
          confirma se a Izabel está ativa.
        </p>
      )}
      {!readError && activationBlock && (
        <p className="text-sm text-muted-foreground">{activationBlock}</p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      )}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (activationButton.current && !activationButton.current.disabled)
              activationButton.current.focus();
            else section.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation?.enabled
                ? "Revalidar a versão da Izabel?"
                : "Ativar a Izabel em todo o Meu Chat?"}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.enabled
                ? "A nova versão poderá responder sem aprovação individual às mensagens elegíveis recebidas após esta revalidação. Atendimentos pausados e mensagens anteriores não serão retomados automaticamente."
                : "Ela poderá enviar respostas em texto sem aprovação individual, para todas as novas mensagens elegíveis desta clínica após a ativação."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              <strong>Canais autorizados: </strong>
              {confirmation?.channels.map(channelLabel).join(", ") || "Nenhum"}. Usa o transporte já
              configurado na conta.
            </p>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>Não responde retroativamente ao histórico ou às sugestões antigas.</li>
              <li>Questões clínicas e dados não verificados passam para a equipe.</li>
              <li>Assumir um atendimento mantém aquela conversa pausada para a Izabel.</li>
              <li>Você pode pausar os novos envios em todo o chat a qualquer momento.</li>
            </ul>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={closeConfirmation}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending || !confirmation}
              onClick={() => {
                if (confirmation) void change(true, confirmation.version);
              }}
            >
              {confirmation?.enabled ? "Confirmar nova versão" : "Ativar atendimento automático"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
