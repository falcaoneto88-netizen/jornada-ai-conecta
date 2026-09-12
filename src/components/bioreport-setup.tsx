import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { configurarRecebimentoBioreport } from "@/lib/bioreport-setup.functions";

export function BioreportSetup({ allowed }: { allowed: boolean }) {
  const configure = useServerFn(configurarRecebimentoBioreport);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  async function activate() {
    setPending(true);
    setResult(null);
    try {
      setResult(await configure({ data: { confirm: true } }));
    } catch {
      setResult({
        ok: false,
        message:
          "Não foi possível validar o acesso. Confira a sessão de administrador e tente novamente.",
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="surface-card space-y-4 p-6" aria-labelledby="bioreport-setup-title">
      <h2 id="bioreport-setup-title" className="text-lg font-semibold">
        Recebimento do BioReport
      </h2>
      <p className="text-sm text-muted-foreground">
        Cadastre a chave já configurada no servidor para receber os estados da anamnese e do
        relatório. Esta ação não envia mensagens, não move etapas e não transmite dados de
        pacientes.
      </p>
      {!allowed && <p className="text-sm">Acesso restrito aos administradores da conta real.</p>}
      <Button disabled={!allowed || pending} onClick={() => void activate()}>
        {pending ? "A configurar…" : "Cadastrar chave de recebimento"}
      </Button>
      {result && (
        <p
          role="status"
          className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
