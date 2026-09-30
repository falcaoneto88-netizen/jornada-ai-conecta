import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, Sparkle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { gerarBriefing } from "@/lib/briefing.functions";
import type { ResultadoBriefing } from "@/lib/briefing.core";
import type { Contact } from "@/lib/demo-data";

/** Briefing clínico-comercial pré-consulta. Só sugestão: nada é enviado nem gravado no GoHighLevel. */
export function BriefingPaciente({ contacto, etapa }: { contacto: Contact; etapa: string }) {
  const executar = useServerFn(gerarBriefing);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<{ b: ResultadoBriefing; para: string } | null>(null);

  async function gerar() {
    setPendente(true);
    setErro(null);
    try {
      const r = await executar({
        data: {
          primeiro_nome: contacto.nome.split(" ")[0] ?? contacto.nome,
          etapa,
          origem: contacto.origem,
          canal: contacto.canal,
          proxima_acao: contacto.proximaAcao,
          agendamento: contacto.agendamento,
          tags: contacto.tags.slice(0, 20),
          historico: contacto.timeline.slice(-20).map((t) => ({
            data: t.data,
            titulo: t.titulo,
            detalhe: t.detalhe.slice(0, 400),
          })),
        },
      });
      if (r.ok) setRes({ b: r.briefing, para: contacto.id });
      else setErro(r.message);
    } catch {
      setErro("Não foi possível gerar o briefing.");
    } finally {
      setPendente(false);
    }
  }

  const b = res?.para === contacto.id ? res.b : null;

  return (
    <section className="rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">Briefing pré-consulta</h3>
        <Button size="sm" variant="outline" disabled={pendente} onClick={() => void gerar()}>
          <Sparkle className="size-4" /> {pendente ? "A gerar…" : "Gerar Briefing com IA"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Resumo de apoio à equipa. Não é diagnóstico nem indicação clínica.
      </p>

      {erro && <p className="mt-3 text-xs text-destructive">{erro}</p>}

      {b && (
        <div className="mt-4 space-y-3 text-sm">
          {b.revisao_clinica && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              Há indícios de queixa ou sintoma no histórico. Encaminhe ao médico antes de responder.
            </p>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Interesses e procedimentos
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground">
              {b.interesses.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dúvidas e objeções
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground">
              {b.duvidas.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Próximo passo recomendado
            </p>
            <p className="mt-1 text-foreground">{b.proximo_passo}</p>
          </div>
        </div>
      )}
    </section>
  );
}
