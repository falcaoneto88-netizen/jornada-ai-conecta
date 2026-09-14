import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganizacao, useEquipaOrganizacao } from "@/lib/organization";
import { useLigacaoGhl, usePapeis, usePermissoes } from "@/lib/repo";
import { useSessao } from "@/lib/session";
import { getGhlSecretsStatus } from "@/lib/ghl.functions";
import { formatarDataHora } from "@/lib/clinic-time";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Jornada AI" },
      {
        name: "description",
        content: "Dados da organização, utilizadores e estado das integrações.",
      },
    ],
  }),
  component: Configuracoes,
});

const rotulos: Record<string, string> = {
  administrador: "Administrador",
  gestor: "Gestor",
  comercial: "Comercial",
  visualizador: "Visualizador",
};

function Configuracoes() {
  const { modo, user } = useSessao();
  const contexto = useOrganizacao();
  const equipa = useEquipaOrganizacao();
  const papeis = usePapeis();
  const permissoes = usePermissoes();
  const ligacao = useLigacaoGhl();
  const consultarSecrets = useServerFn(getGhlSecretsStatus);
  const secrets = useQuery({
    queryKey: ["estado-secrets", user?.id ?? "anonimo"],
    enabled: modo === "conta",
    queryFn: () => consultarSecrets(),
    staleTime: 60_000,
  });
  const org = contexto.data?.organizacao;
  const estadoGhl = ligacao.isError
    ? "Não foi possível consultar"
    : ligacao.isPending
      ? "A consultar…"
      : ligacao.data?.status === "conectada"
        ? "Ligação validada"
        : ligacao.data?.status === "erro"
          ? "Erro na última validação"
          : "Ligação ainda não validada";
  const estadoIa = secrets.isError
    ? "Não foi possível verificar"
    : secrets.isPending
      ? "A verificar…"
      : !secrets.data?.configurada
        ? "Estado indisponível nesta organização"
        : secrets.data.ia
          ? "Chave configurada; operação não testada"
          : "Chave não configurada";

  return (
    <AppShell title="Configurações" description={org?.name ?? "Equipa, clínica e sistema"}>
      {modo === "demo" ? (
        <section className="surface-card p-6">
          <h2 className="font-semibold">Modo demonstração</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicie sessão para consultar a clínica e os utilizadores reais.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/auth" search={{ next: "" }}>
              Iniciar sessão
            </Link>
          </Button>
        </section>
      ) : contexto.isError ? (
        <section role="alert" className="surface-card p-6">
          <p>{contexto.error.message}</p>
          <Button variant="outline" className="mt-3" onClick={() => void contexto.refetch()}>
            Tentar novamente
          </Button>
        </section>
      ) : !org ? (
        <p role="status">A carregar configuração…</p>
      ) : (
        <Tabs defaultValue="equipa">
          <TabsList>
            <TabsTrigger value="equipa">Utilizadores</TabsTrigger>
            <TabsTrigger value="clinica">Clínica</TabsTrigger>
            <TabsTrigger value="sistema">Sistema</TabsTrigger>
          </TabsList>
          <TabsContent value="equipa" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Utilizadores da organização atual. Convites e alteração de papéis ainda não estão
              disponíveis nesta tela. Apenas os seus papéis são consultáveis pela sessão atual.
            </p>
            {equipa.isError ? (
              <p role="alert">
                Não foi possível ler os utilizadores.{" "}
                <Button variant="outline" size="sm" onClick={() => void equipa.refetch()}>
                  Tentar novamente
                </Button>
              </p>
            ) : equipa.isPending ? (
              <p role="status">A carregar utilizadores…</p>
            ) : (
              <div className="surface-card overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-heading text-background">
                    <tr>
                      <th className="px-4 py-3 text-left">Nome</th>
                      <th className="px-4 py-3 text-left">E-mail</th>
                      <th className="px-4 py-3 text-left">Papel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipa.data?.map((u) => (
                      <tr key={u.id} className="border-b border-border">
                        <td className="px-4 py-3">
                          {u.full_name || "Nome não informado"}
                          {u.id === user?.id ? " (você)" : ""}
                        </td>
                        <td className="px-4 py-3">{u.email || "Não informado"}</td>
                        <td className="px-4 py-3">
                          {u.id !== user?.id
                            ? "Não consultável"
                            : papeis.isError
                              ? "Não foi possível consultar"
                              : papeis.isPending
                                ? "A consultar…"
                                : papeis.data?.map((p) => rotulos[p] ?? p).join(", ") ||
                                  "Sem papel atribuído"}
                        </td>
                      </tr>
                    ))}
                    {equipa.data?.length === 0 && (
                      <tr>
                        <td colSpan={3} className="p-4">
                          Nenhum utilizador visível nesta organização.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <section className="surface-card p-6">
              <h2 className="font-semibold">Permissões da sua conta</h2>
              {papeis.isError ? (
                <p role="alert" className="mt-3">
                  Não foi possível consultar os seus papéis.
                </p>
              ) : papeis.isPending ? (
                <p role="status">A consultar…</p>
              ) : (
                <ul className="mt-3 divide-y divide-border text-sm">
                  {[
                    { acao: "Operar contactos e mensagens", permitida: permissoes.operar },
                    {
                      acao: "Gerir definições locais da jornada",
                      permitida: permissoes.gerirJornada,
                    },
                    { acao: "Gerir integrações", permitida: permissoes.gerirIntegracao },
                  ].map((p) => (
                    <li key={p.acao} className="flex flex-wrap justify-between gap-3 py-3">
                      <span>{p.acao}</span>
                      <Badge variant="outline">
                        {p.permitida ? "Permitido pelo papel" : "Não permitido"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                O envio também depende da integração e da habilitação de escrita no GHL. A permissão
                não confirma que uma função esteja implementada.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="clinica" className="mt-4">
            <section className="surface-card p-6">
              <h2 className="font-semibold">Dados cadastrados da clínica</h2>
              <dl className="mt-4 grid gap-5 sm:grid-cols-2">
                {[
                  ["Nome", org.name],
                  ["Fuso horário", org.timezone],
                  ["Organização", org.id],
                  ["Tipo de organização", org.is_demo ? "Demonstração" : "Conta real"],
                  ["E-mail da clínica", "Não cadastrado no modelo atual"],
                  ["Horário de atendimento", "Não cadastrado no modelo atual"],
                ].map(([titulo, valor]) => (
                  <div key={titulo}>
                    <dt className="text-sm text-muted-foreground">{titulo}</dt>
                    <dd className="mt-1 break-words font-medium">{valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-sm text-muted-foreground">
                Consulta dos dados guardados. A edição da clínica ainda não está disponível nesta
                tela.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="sistema" className="mt-4 space-y-4">
            <section className="surface-card p-6">
              <h2 className="font-semibold">Estado consultado</h2>
              <dl className="mt-4 space-y-4">
                {[
                  ["Base de dados", "Leitura da organização concluída"],
                  ["GoHighLevel", estadoGhl],
                  [
                    "Última validação GHL",
                    formatarDataHora(ligacao.data?.last_test_at, org.timezone),
                  ],
                  [
                    "Escrita GHL",
                    ligacao.isError
                      ? "Não foi possível consultar"
                      : ligacao.isPending
                        ? "A consultar…"
                        : ligacao.data?.write_enabled
                          ? "Habilitada"
                          : "Desativada",
                  ],
                  [
                    "Calendário associado",
                    ligacao.isError
                      ? "Não foi possível consultar"
                      : ligacao.isPending
                        ? "A consultar…"
                        : ligacao.data?.calendar_id
                          ? "Configurado"
                          : "Não configurado",
                  ],
                  ["Assistente de IA", estadoIa],
                ].map(([titulo, valor]) => (
                  <div key={titulo} className="flex flex-wrap justify-between gap-3 text-sm">
                    <dt>{titulo}</dt>
                    <dd className="text-muted-foreground">{valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                Horários em {org.timezone}. Configuração e última validação não garantem
                disponibilidade atual de todas as operações.
              </p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/integracoes">Ver integrações</Link>
              </Button>
            </section>
            <section className="surface-card p-6">
              <h2 className="font-semibold">Retenção de registos</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Não há política automática de retenção implementada no app para auditoria, execuções
                ou webhooks. Nenhum prazo de eliminação está configurado nesta tela.
              </p>
            </section>
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}
