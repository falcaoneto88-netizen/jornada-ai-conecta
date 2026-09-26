import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { estadoJev, testarJev } from "@/lib/jev.functions";
import { MENSAGENS_JEV, type EstadoJev, type TesteRegistado } from "@/lib/jev.core";
import { formatarDataHora } from "@/lib/clinic-time";

function Linha({ t, rotulo }: { t: TesteRegistado; rotulo: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {rotulo}: {formatarDataHora(t.em)}
      {t.modelo ? ` · ${t.modelo}` : ""}
      {t.latencia_ms !== null ? ` · ${t.latencia_ms} ms` : ""} · {MENSAGENS_JEV[t.categoria]}
    </p>
  );
}

export function EstadoJevView({ estado }: { estado: EstadoJev }) {
  switch (estado.tipo) {
    case "sem_chave":
      return <Badge variant="outline">Chave ausente</Badge>;
    case "sem_teste":
      return (
        <div className="space-y-1">
          <Badge variant="outline">Configurado, sem teste</Badge>
          <p className="text-xs text-muted-foreground">Chave presente não significa ligação verificada.</p>
        </div>
      );
    case "sucesso":
      return (
        <div className="space-y-1">
          <Badge>Último teste bem-sucedido</Badge>
          <Linha t={estado.ultimo} rotulo="Último teste (histórico, não garantia atual)" />
        </div>
      );
    case "falha":
      return (
        <div className="space-y-1">
          <Badge variant="destructive">Último teste falhou</Badge>
          <Linha t={estado.ultimo} rotulo="Último teste" />
          {estado.ultimoSucesso && <Linha t={estado.ultimoSucesso} rotulo="Sucesso anterior (histórico)" />}
        </div>
      );
  }
}

export function JevCard({ allowed, escopo }: { allowed: boolean; escopo: string }) {
  const ler = useServerFn(estadoJev);
  const testar = useServerFn(testarJev);
  const qc = useQueryClient();
  const emCurso = useRef(false);
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const chave = ["jev-estado", escopo];
  const q = useQuery({ queryKey: chave, queryFn: () => ler(), enabled: allowed });
  if (!allowed) return null;

  async function executar() {
    if (emCurso.current) return;
    emCurso.current = true;
    setPending(true);
    setErro(null);
    try {
      const r = await testar();
      if (!r.ok) setErro(MENSAGENS_JEV[r.categoria]);
    } catch {
      setErro(MENSAGENS_JEV.indisponivel);
    } finally {
      emCurso.current = false;
      setPending(false);
      await qc.invalidateQueries({ queryKey: chave });
    }
  }

  const estado = q.data && q.data.ok ? q.data.estado : null;
  return (
    <section className="surface-card space-y-3 p-6" aria-label="Jev / OpenRouter">
      <h2 className="text-lg font-semibold">Jev / OpenRouter</h2>
      <p className="text-sm text-muted-foreground">
        Modelo de decisão TypeSafe via OpenRouter. O teste classifica apenas uma mensagem fictícia fixa; não
        usa dados de pacientes, não aciona o CRM nem envia mensagens.
      </p>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : estado ? (
        <EstadoJevView estado={estado} />
      ) : (
        <p className="text-sm text-muted-foreground">{MENSAGENS_JEV.sem_permissao}</p>
      )}
      <Button
        variant="outline"
        disabled={pending || !estado || estado.tipo === "sem_chave"}
        onClick={() => void executar()}
      >
        {pending ? "A testar…" : "Testar conexão Jev"}
      </Button>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </section>
  );
}
