import type { PendenciaContacto } from "@/lib/ghl-contacts.core";

export function SyncPendencias({ pendencias }: { pendencias: PendenciaContacto[] }) {
  if (!pendencias.length) return null;
  return (
    <section
      role="status"
      className="rounded-lg border p-4 space-y-2"
      aria-label="Pendências da sincronização"
    >
      <h2 className="font-semibold">Pendências da última sincronização ({pendencias.length})</h2>
      <p className="text-sm">
        Os demais contactos foram processados. Use o ID abaixo para localizar o contacto no
        GoHighLevel. Esta lista fica disponível nesta página até a próxima sincronização.
      </p>
      <div className="max-h-80 overflow-auto">
        <ul className="space-y-3">
          {pendencias.map((p, i) => (
            <li key={`${p.contactId ?? "nao-verificado"}-${i}`} className="text-sm">
              <p>
                {p.contactId ? (
                  <>
                    ID do contacto: <code className="select-all">{p.contactId}</code>
                  </>
                ) : (
                  "Identidade não confirmada — identificador oculto por segurança."
                )}
              </p>
              <p>
                {p.message} <span className="text-muted-foreground">({p.code})</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
