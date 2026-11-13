import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMessageLibrary } from "@/lib/message-library.functions";
import { readAttendanceContext } from "@/lib/attendance-context.functions";
import { canaisModelo, previsualizarModelo, contextoDaConsulta } from "@/lib/message-library.core";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type TemplateInsertMode = "cursor" | "append" | "replace";

/** Uses the same library/cache as /modelos; never creates, approves or sends a template. */
export function InboxTemplatePicker({
  organizationId,
  contactId,
  scope,
  clinicName,
  hasDraft,
  draftVersion,
  disabled,
  onInsert,
}: {
  organizationId: string;
  contactId: string;
  scope: string;
  clinicName: string;
  hasDraft: boolean;
  draftVersion: number;
  disabled: boolean;
  onInsert: (text: string, mode: TemplateInsertMode) => boolean;
}) {
  const read = useServerFn(getMessageLibrary);
  const readContext = useServerFn(readAttendanceContext);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [channel, setChannel] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<TemplateInsertMode>("cursor");
  const [replaceConfirmed, setReplaceConfirmed] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const library = useQuery({
    queryKey: ["message-library", scope, organizationId],
    queryFn: () => read({ data: { organizationId } }),
    retry: false,
  });
  const context = useQuery({
    queryKey: ["attendance-context", scope, organizationId, contactId],
    queryFn: () => readContext({ data: { organizationId, ghlContactId: contactId } }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const data = context.data?.ok && !context.isError ? context.data.data : null;
  const appointment = data?.nextAppointment;
  const values =
    appointment && data
      ? contextoDaConsulta(
          { start_at: appointment.startAt, title: appointment.title, assigned_user_name: null },
          data.contact.name,
          clinicName,
          data.timezone,
        )
      : {
          "contact.name": data?.contact.name ?? null,
          "contact.first_name": data?.contact.name.trim().split(/\s+/)[0] ?? null,
          "location.name": clinicName,
        };
  const templates = (library.isError ? [] : (library.data?.modelos ?? [])).filter(
    (m) =>
      m.lifecycle === "draft" &&
      (!language || m.language === language) &&
      (!channel || m.channel === channel) &&
      `${m.name} ${m.body}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const model = templates.find((m) => m.id === selected);
  const preview = model ? previsualizarModelo(model.body, values) : null;
  const replacementKey = JSON.stringify([draftVersion, model?.id, model?.revision, preview?.texto]);
  const replacementAccepted = replaceConfirmed === replacementKey;
  const selectClass =
    "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <section className="min-w-0 space-y-3 p-4 text-sm" aria-label="Textos-base da biblioteca">
      <div>
        <h3 className="font-semibold">Texto-base</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Mesmo acervo de Modelos de Mensagem. São rascunhos para revisão.
        </p>
      </div>
      <Input
        aria-label="Buscar texto-base"
        placeholder="Buscar modelo"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={selectClass}
          aria-label="Idioma do modelo"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="">Todos os idiomas</option>
          {[...new Set(library.data?.modelos.map((m) => m.language) ?? [])].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label="Canal do modelo"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">Todos os canais</option>
          {Object.entries(canaisModelo).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {library.isPending && <p role="status">A carregar modelos…</p>}
      {library.isError && (
        <div role="alert">
          <p>Não foi possível carregar os modelos.</p>
          <Button size="sm" variant="outline" onClick={() => void library.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!library.isPending && !library.isError && templates.length === 0 && (
        <p>Nenhum modelo corresponde aos filtros.</p>
      )}
      {templates.length > 0 && (
        <label className="grid gap-1">
          Modelo
          <select
            className={selectClass}
            value={model?.id ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setReplaceConfirmed(null);
              setNotice("");
            }}
          >
            <option value="">Selecione para visualizar</option>
            {templates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.language}
              </option>
            ))}
          </select>
        </label>
      )}
      {model && preview && (
        <>
          <p className="text-xs text-muted-foreground">
            Revisão {model.revision} · {canaisModelo[model.channel]} · {model.language}
          </p>
          {model.usage_note && <p>{model.usage_note}</p>}
          <p
            className="whitespace-pre-wrap break-words rounded-md bg-secondary/50 p-3"
            aria-label="Prévia do texto-base"
          >
            {preview.texto}
          </p>
          {appointment && (
            <p className="text-xs text-muted-foreground">
              Consulta vinculada no Jornada · {data?.timezone}. Confira horário e estado no Contexto
              antes de usar.
            </p>
          )}
          {!preview.completo && (
            <p role="status">
              Dados pendentes:{" "}
              {[...preview.ausentes, ...preview.invalidas].join(", ") || "variáveis incompletas"}. O
              texto só poderá ser inserido após conferir esses dados.
            </p>
          )}
          {preview.texto.length > 1500 && (
            <p role="status">
              Este texto ultrapassa os 1.500 caracteres do compositor. Edite o modelo antes de
              inserir.
            </p>
          )}
          {hasDraft && (
            <label className="grid gap-1">
              Como inserir
              <select
                className={selectClass}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as TemplateInsertMode);
                  setReplaceConfirmed(null);
                }}
              >
                <option value="cursor">Na posição do cursor</option>
                <option value="append">Acrescentar ao final</option>
                <option value="replace">Substituir o rascunho</option>
              </select>
            </label>
          )}
          {hasDraft && mode === "replace" && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={replacementAccepted}
                onChange={(e) => setReplaceConfirmed(e.target.checked ? replacementKey : null)}
              />
              Quero substituir o texto atual por este modelo.
            </label>
          )}
          <Button
            size="sm"
            disabled={
              disabled ||
              !preview.completo ||
              preview.texto.length > 1500 ||
              (hasDraft && mode === "replace" && !replacementAccepted)
            }
            onClick={() => {
              const inserted = onInsert(preview.texto, hasDraft ? mode : "append");
              setReplaceConfirmed(null);
              setNotice(
                inserted
                  ? "Texto preparado para o rascunho. Confira antes de enviar."
                  : "O texto atual foi preservado. Confira o aviso no compositor.",
              );
            }}
          >
            Inserir no rascunho
          </Button>
          {notice && (
            <p role="status" className="text-xs">
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
