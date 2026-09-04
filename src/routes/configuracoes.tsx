import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { equipa } from "@/lib/demo-data";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content: "Utilizadores e papéis, identidade da clínica, fuso horário, retenção de registos e saúde do sistema.",
      },
      { property: "og:title", content: "Configurações — Jornada AI" },
      { property: "og:description", content: "Papéis, identidade da clínica, fusos horários e saúde do sistema." },
    ],
  }),
  component: Configuracoes,
});

const permissoes = [
  { acao: "Ver painéis e clientes", papeis: "Todos os papéis" },
  { acao: "Enviar mensagens", papeis: "Administrador, Gestor, Comercial" },
  { acao: "Mover etapas da jornada", papeis: "Administrador, Gestor, Comercial" },
  { acao: "Criar e ativar automações", papeis: "Administrador, Gestor" },
  { acao: "Gerir integrações e secrets", papeis: "Administrador" },
  { acao: "Gerir utilizadores e papéis", papeis: "Administrador" },
];

function Configuracoes() {
  return (
    <AppShell title="Configurações" description="Equipa, clínica e sistema">
      <Tabs defaultValue="equipa">
        <TabsList>
          <TabsTrigger value="equipa">Utilizadores</TabsTrigger>
          <TabsTrigger value="clinica">Clínica</TabsTrigger>
          <TabsTrigger value="sistema">Sistema</TabsTrigger>
        </TabsList>

        <TabsContent value="equipa" className="mt-4 space-y-4">
          <div className="surface-card overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-heading text-background">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Nome</th>
                  <th className="px-4 py-3 text-left font-medium">E-mail</th>
                  <th className="px-4 py-3 text-left font-medium">Papel</th>
                </tr>
              </thead>
              <tbody>
                {equipa.map((u, i) => (
                  <tr key={u.email} className={i % 2 === 1 ? "bg-secondary/40" : undefined}>
                    <td className="px-4 py-3 font-medium text-heading">{u.nome}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{u.papel}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="surface-card p-6">
            <h2 className="text-base font-semibold">Permissões por ação</h2>
            <ul className="mt-3 divide-y divide-border text-sm">
              {permissoes.map((p) => (
                <li key={p.acao} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-heading">{p.acao}</span>
                  <span className="text-muted-foreground">{p.papeis}</span>
                </li>
              ))}
            </ul>
          </section>
        </TabsContent>

        <TabsContent value="clinica" className="mt-4">
          <section className="surface-card grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
            <div>
              <Label htmlFor="nome-clinica">Nome da clínica</Label>
              <Input id="nome-clinica" defaultValue="Clínica Dr. João Falcão" className="mt-1.5 bg-card" />
            </div>
            <div>
              <Label htmlFor="email-clinica">E-mail de contacto</Label>
              <Input id="email-clinica" defaultValue="contacto@exemplo.pt" className="mt-1.5 bg-card" />
            </div>
            <div>
              <Label htmlFor="fuso">Fuso horário</Label>
              <Select defaultValue="lisboa">
                <SelectTrigger id="fuso" className="mt-1.5 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lisboa">Portugal — Europe/Lisbon</SelectItem>
                  <SelectItem value="saopaulo">Brasil — America/Sao_Paulo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="horario">Horário de atendimento</Label>
              <Input id="horario" defaultValue="09:00 — 19:00" className="mt-1.5 bg-card" />
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => toast.success("Identidade da clínica guardada (demonstração).")}>Guardar</Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="sistema" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="surface-card p-6">
            <h2 className="text-base font-semibold">Retenção de registos</h2>
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Registos de auditoria</span>
                <Badge variant="outline">24 meses</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Execuções de automações</span>
                <Badge variant="outline">12 meses</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Eventos de webhook</span>
                <Badge variant="outline">6 meses</Badge>
              </div>
            </div>
          </section>

          <section className="surface-card p-6">
            <h2 className="text-base font-semibold">Saúde do sistema</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span>Aplicação</span>
                <Badge>Operacional</Badge>
              </li>
              <li className="flex items-center justify-between">
                <span>Base de dados</span>
                <Badge variant="outline">Por configurar (Fase 2)</Badge>
              </li>
              <li className="flex items-center justify-between">
                <span>Integração GoHighLevel</span>
                <Badge variant="outline">Demonstração</Badge>
              </li>
              <li className="flex items-center justify-between">
                <span>Assistente de IA</span>
                <Badge variant="outline">Por configurar (Fase 2)</Badge>
              </li>
            </ul>
          </section>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
