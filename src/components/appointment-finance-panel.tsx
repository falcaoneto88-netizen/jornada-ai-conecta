import { useEffect, useId, useRef, useState } from "react";
import { formatarDataHora } from "@/lib/clinic-time";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type AppointmentFinanceEntry = {
  appointmentId: string;
  totalCents: number;
  depositCents: number;
  currency: "EUR";
  revision: number;
  updatedAt: string;
  updatedBy: string;
};

export type AppointmentFinanceSaveInput = {
  totalCents: number;
  depositCents: number;
  expectedRevision: number;
  requestId: string;
};

export type AppointmentFinancePanelProps = {
  entry: AppointmentFinanceEntry | null;
  available: boolean;
  canEdit: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSave: (input: AppointmentFinanceSaveInput) => Promise<void>;
  fuso: string;
};

const MAX_CENTS = 100_000_000;
const money = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

function inputValue(cents: number) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(/[,.]/);
  // Integer arithmetic keeps values such as 1,01 exact; no floating-point rounding.
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

function signature(entry: AppointmentFinanceEntry | null) {
  return JSON.stringify(
    entry && [entry.appointmentId, entry.revision, entry.totalCents, entry.depositCents],
  );
}

function initial(entry: AppointmentFinanceEntry | null) {
  return {
    signature: signature(entry),
    revision: entry?.revision ?? 0,
    total: entry ? inputValue(entry.totalCents) : "",
    deposit: entry ? inputValue(entry.depositCents) : "",
  };
}

/** Mount with the appointment's stable ID as React key, including entries not yet recorded. */
export function AppointmentFinancePanel({
  entry,
  available,
  canEdit,
  loading,
  error,
  onRetry,
  onSave,
  fuso,
}: AppointmentFinancePanelProps) {
  const id = useId();
  const [baseline, setBaseline] = useState(() => initial(entry));
  const [total, setTotal] = useState(baseline.total);
  const [deposit, setDeposit] = useState(baseline.deposit);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [receipt, setReceipt] = useState<Omit<AppointmentFinanceSaveInput, "requestId"> | null>(
    null,
  );
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const totalInput = useRef<HTMLInputElement>(null);
  const depositInput = useRef<HTMLInputElement>(null);
  const dirty = total !== baseline.total || deposit !== baseline.deposit;
  const remoteChanged = signature(entry) !== baseline.signature;
  const totalCents = parseAmount(total);
  const depositCents = parseAmount(deposit);
  const totalError =
    totalCents === null
      ? !total.trim()
        ? "Informe o valor total do procedimento."
        : "Use um valor de 0 a 1.000.000 EUR, com até duas casas decimais e sem separador de milhar."
      : null;
  const depositError =
    depositCents === null
      ? !deposit.trim()
        ? "Informe o sinal. Use 0,00 se não houver sinal a registrar."
        : "Use um valor positivo ou zero, com até duas casas decimais e sem separador de milhar."
      : totalCents !== null && depositCents > totalCents
        ? "O sinal não pode ser maior que o valor total."
        : null;
  const blocked =
    !available || !canEdit || loading || Boolean(error) || pending || remoteChanged || !!receipt;
  const draftBalance =
    totalCents !== null && depositCents !== null && !depositError
      ? totalCents - depositCents
      : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (pending || loading || error || !available) return;
    const savedEntryArrived =
      receipt &&
      entry &&
      entry.revision > receipt.expectedRevision &&
      entry.totalCents === receipt.totalCents &&
      entry.depositCents === receipt.depositCents;
    if ((!dirty && remoteChanged && !receipt) || savedEntryArrived) {
      const next = initial(entry);
      setBaseline(next);
      setTotal(next.total);
      setDeposit(next.deposit);
      setAttempted(false);
      setSaveError(null);
      setReceipt(null);
      intent.current = null;
    }
  }, [available, dirty, entry, error, loading, pending, receipt, remoteChanged]);

  function edit(field: "total" | "deposit", value: string) {
    if (blocked) return;
    if (field === "total") setTotal(value);
    else setDeposit(value);
    intent.current = null;
    setSaveError(null);
    setSaved(false);
  }

  function useLatest() {
    const next = initial(entry);
    setBaseline(next);
    setTotal(next.total);
    setDeposit(next.deposit);
    setAttempted(false);
    setSaveError(null);
    setReceipt(null);
    setSaved(false);
    intent.current = null;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || pendingRef.current || !dirty) return;
    setAttempted(true);
    if (totalError || depositError || totalCents === null || depositCents === null) {
      (totalError ? totalInput : depositInput).current?.focus();
      return;
    }
    const payload = { totalCents, depositCents, expectedRevision: baseline.revision };
    const fingerprint = JSON.stringify(payload);
    if (!intent.current || intent.current.fingerprint !== fingerprint) {
      intent.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    pendingRef.current = true;
    setPending(true);
    setSaveError(null);
    setSaved(false);
    try {
      await onSave({ ...payload, requestId: intent.current.requestId });
      if (!mounted.current) return;
      setReceipt(payload);
      setSaved(true);
      intent.current = null;
      onRetry();
    } catch {
      if (!mounted.current) return;
      // A rejected request may have reached the server. Preserve its identity for a safe retry.
      setSaveError(
        "Não foi possível confirmar a gravação. Seu rascunho foi preservado. Tente salvar novamente ou atualize os valores para conferir o registro.",
      );
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4 border-t pt-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id={`${id}-title`} className="font-semibold text-heading">
          Valores do procedimento
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={loading || pending}
        >
          Atualizar valores
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" id={`${id}-source`}>
        Registro manual do Jornada AI. O sinal informado não confirma pagamento bancário e não
        altera o agendamento no GHL.
      </p>

      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          A consultar valores do procedimento…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} Use “Atualizar valores” para tentar novamente.
        </p>
      )}
      {!available && !loading && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Registro financeiro ainda indisponível neste ambiente. A preparação do banco precisa estar
          concluída antes de registrar valores.
        </p>
      )}

      {entry ? (
        <div className="space-y-3" aria-label="Valores registrados">
          {(loading || error) && (
            <p className="text-xs text-muted-foreground">Último registro consultado</p>
          )}
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-muted-foreground">Valor total</dt>
              <dd className="mt-1 break-words font-medium tabular-nums">
                {money.format(entry.totalCents / 100)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Sinal informado</dt>
              <dd className="mt-1 break-words font-medium tabular-nums">
                {money.format(entry.depositCents / 100)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Saldo a receber</dt>
              <dd className="mt-1 break-words font-semibold tabular-nums text-heading">
                {money.format((entry.totalCents - entry.depositCents) / 100)}
              </dd>
            </div>
          </dl>
          <p className="break-words text-xs text-muted-foreground">
            Atualizado em {formatarDataHora(entry.updatedAt, fuso)} ({fuso}).
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Identificação do registro
            </summary>
            <p className="mt-2 break-words">
              Identificador do responsável: <span className="break-all">{entry.updatedBy}</span>.
            </p>
          </details>
        </div>
      ) : available && !loading && !error ? (
        <p className="text-sm text-muted-foreground">
          Valores ainda não informados. O saldo será calculado depois de registrar o total e o
          sinal.
        </p>
      ) : null}

      {available && !loading && !error && !canEdit && (
        <p className="text-sm text-muted-foreground">
          Seu perfil permite consultar estes valores, mas não editá-los.
        </p>
      )}

      {remoteChanged && dirty && !pending && !loading && !error && !receipt && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            Os valores registrados mudaram durante sua edição. Seu rascunho foi preservado e o
            salvamento está bloqueado para evitar substituir outra atualização.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={useLatest}>
            Descartar rascunho e usar valores atualizados
          </Button>
        </div>
      )}
      {receipt && !loading && !error && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            Gravação concluída. Aguarde a leitura do registro atualizado antes de editar novamente.
          </p>
          {remoteChanged &&
            entry &&
            (entry.totalCents !== receipt.totalCents ||
              entry.depositCents !== receipt.depositCents) && (
              <Button type="button" variant="outline" size="sm" onClick={useLatest}>
                Conferir e usar valores atualizados
              </Button>
            )}
        </div>
      )}

      {canEdit && (
        <form onSubmit={(event) => void save(event)} noValidate className="space-y-3">
          <fieldset disabled={blocked} aria-describedby={`${id}-source`} className="space-y-3">
            <legend className="sr-only">Editar valores do procedimento</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${id}-total`}>Valor total do procedimento (EUR)</Label>
                <Input
                  ref={totalInput}
                  id={`${id}-total`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={total}
                  placeholder="Não informado"
                  maxLength={16}
                  aria-invalid={attempted && !!totalError}
                  aria-describedby={attempted && totalError ? `${id}-total-error` : undefined}
                  onChange={(event) => edit("total", event.target.value)}
                />
                {attempted && totalError && (
                  <p id={`${id}-total-error`} className="text-sm text-destructive">
                    {totalError}
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${id}-deposit`}>Sinal informado (EUR)</Label>
                <Input
                  ref={depositInput}
                  id={`${id}-deposit`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={deposit}
                  placeholder="Não informado"
                  maxLength={16}
                  aria-invalid={attempted && !!depositError}
                  aria-describedby={
                    attempted && depositError ? `${id}-deposit-error` : `${id}-deposit-hint`
                  }
                  onChange={(event) => edit("deposit", event.target.value)}
                />
                <p id={`${id}-deposit-hint`} className="text-xs text-muted-foreground">
                  Use 0,00 apenas se não houver sinal a registrar.
                </p>
                {attempted && depositError && (
                  <p id={`${id}-deposit-error`} className="text-sm text-destructive">
                    {depositError}
                  </p>
                )}
              </div>
            </div>
            {dirty && draftBalance !== null && (
              <p className="text-sm tabular-nums" role="status">
                Saldo após salvar: <strong>{money.format(draftBalance / 100)}</strong>.
              </p>
            )}
            <Button type="submit" disabled={blocked || !dirty}>
              {pending
                ? "Salvando valores…"
                : saveError
                  ? "Tentar salvar novamente"
                  : "Salvar valores"}
            </Button>
          </fieldset>
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
          {saved && !receipt && (
            <p role="status" className="text-sm text-success">
              Valores salvos e registro atualizado.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
