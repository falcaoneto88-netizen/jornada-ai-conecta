import { createFileRoute } from "@tanstack/react-router";
import { Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { mascararTelefone, stageName, type Contact } from "@/lib/demo-data";
import { useContactos, useEtapas, useModoDados } from "@/lib/repo";
import { syncGhl } from "@/lib/ghl.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content: "Base de pacientes e leads com fase da jornada, tags, origem, responsável e histórico completo.",
      },
      { property: "og:title", content: "Clientes — Jornada AI" },
      { property: "og:description", content: "Base de pacientes e leads com fase, tags, origem e histórico." },
    ],
  }),
  component: Clientes,
});

function Clientes() {
  const { demo } = useModoDados();
  const { data: contacts = [], isLoading, error } = useContactos();
  const { data: etapas = [] } = useEtapas();
  const sincronizar = useServerFn(syncGhl);
  const [aSincronizar, setASincronizar] = useState(false);
  const [busca, setBusca] = useState("");
  const [etapa, setEtapa] = useState("todas");
  const [detalhe, setDetalhe] = useState<Contact | null>(null);

  async function sincronizarGhl() {
    if (demo) {
      toast.error("Sincronização indisponível em modo demonstração.");
      return;
    }
    setASincronizar(true);
    try {
      const res = await sincronizar();
      if (res.ok) toast.success(`Sincronização concluída: ${res.importados} contactos importados.`);
      else toast.error(res.message);
    } catch {
      toast.error("Falha ao contactar o servidor de sincronização.");
    } finally {
      setASincronizar(false);
    }
  }

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contacts.filter((c) => {
      const bate =
        !termo ||
        c.nome.toLowerCase().includes(termo) ||
        c.email.toLowerCase().includes(termo) ||
        c.telefone.includes(termo);
      return bate && (etapa === "todas" || c.etapa === etapa);
    });
  }, [busca, etapa, contacts]);

  function exportarCsv() {
    const linhas = [
      ["Nome", "Telefone", "E-mail", "Fase", "Origem", "Responsável", "Última interação"],
      ...filtrados.map((c) => [
        c.nome,
        c.telefone,
        c.email,
        stageName(c.etapa),
        c.origem,
        c.responsavel,
        c.ultimaInteracao,
      ]),
    ];
    const csv = linhas.map((l) => l.map((v) => `"${v}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes-demo.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ficheiro CSV exportado.");
  }

  return (
    <AppShell
      title="Clientes"
      description={`${contacts.length} ${demo ? "registos de demonstração" : "registos"}`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void sincronizarGhl()} disabled={aSincronizar}>
            <RefreshCw className={`size-4 ${aSincronizar ? "animate-spin" : ""}`} />
            {aSincronizar ? "A sincronizar…" : "Sincronizar"}
          </Button>
          <Button variant="secondary" onClick={exportarCsv} disabled={filtrados.length === 0}>
            <Download className="size-4" /> CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {demo && (
          <DemoNotice texto="Registos DEMO. A deduplicação usa GHL Contact ID, telefone normalizado e e-mail quando a ligação estiver ativa." />
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar por nome, e-mail ou telefone"
              aria-label="Procurar clientes"
              className="bg-card pl-9"
            />
          </div>
          <Select value={etapa} onValueChange={setEtapa}>
            <SelectTrigger className="w-full bg-card sm:w-[220px]" aria-label="Filtrar por fase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as fases</SelectItem>
              {journeyStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="surface-card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-heading text-background">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nome</th>
                <th className="px-4 py-3 text-left font-medium">Telefone</th>
                <th className="px-4 py-3 text-left font-medium">E-mail</th>
                <th className="px-4 py-3 text-left font-medium">Fase</th>
                <th className="px-4 py-3 text-left font-medium">Origem</th>
                <th className="px-4 py-3 text-left font-medium">Responsável</th>
                <th className="px-4 py-3 text-left font-medium">Próxima ação</th>
                <th className="px-4 py-3 text-left font-medium">Última interação</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => setDetalhe(c)}
                  className={`cursor-pointer transition-colors hover:bg-accent/40 ${i % 2 === 1 ? "bg-secondary/40" : ""}`}
                >
                  <td className="px-4 py-3 font-medium text-heading">{c.nome}</td>
                  <td className="px-4 py-3">{mascararTelefone(c.telefone)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{stageName(c.etapa)}</Badge>
                  </td>
                  <td className="px-4 py-3">{c.origem}</td>
                  <td className="px-4 py-3">{c.responsavel}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.proximaAcao}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.ultimaInteracao}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    Nenhum cliente encontrado com estes critérios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={detalhe !== null} onOpenChange={(o) => !o && setDetalhe(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detalhe?.nome}</SheetTitle>
            <SheetDescription>Timeline completa do cliente.</SheetDescription>
          </SheetHeader>
          {detalhe && (
            <div className="space-y-5 px-4 pb-8">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Fase</dt>
                  <dd className="text-heading">{stageName(detalhe.etapa)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Origem</dt>
                  <dd className="text-heading">{detalhe.origem}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Telefone</dt>
                  <dd className="text-heading">{mascararTelefone(detalhe.telefone)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Responsável</dt>
                  <dd className="text-heading">{detalhe.responsavel}</dd>
                </div>
              </dl>
              <ol className="space-y-3 border-l border-border pl-4">
                {detalhe.timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                    <p className="text-sm font-medium text-heading">{t.titulo}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.data} — {t.detalhe}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
