// @vitest-environment jsdom
import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({
  modo: "conta",
  painel: {} as Record<string, unknown>,
  lerPainel: vi.fn(),
  secrets: { configurada: true, ia: true },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opcoes: unknown) => opcoes,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: estado.secrets, isPending: false, isError: false }),
}));
vi.mock("@/lib/ghl.functions", () => ({ getGhlSecretsStatus: vi.fn() }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("@/lib/session", () => ({
  useSessao: () => ({ modo: estado.modo, carregando: false, user: { id: "user-a" } }),
}));
vi.mock("@/lib/dashboard", () => ({
  usePainel: (dias: number) => {
    estado.lerPainel(dias);
    return estado.painel;
  },
}));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({
    data: {
      organizacao: {
        id: "org-a",
        name: "Clínica real de teste",
        timezone: "Europe/Lisbon",
        is_demo: false,
      },
    },
  }),
  useEquipaOrganizacao: () => ({
    data: [{ id: "user-a", full_name: "Utilizador real", email: "real@teste.invalid" }],
  }),
}));
vi.mock("@/lib/repo", () => ({
  rotuloEstadoMarcacao: (estado: string) => (estado === "confirmada" ? "Confirmada" : estado),
  useLigacaoGhl: () => ({
    data: {
      status: "conectada",
      write_enabled: false,
      calendar_id: "cal-a",
      last_test_at: "2026-09-14T12:00:00Z",
    },
  }),
  usePapeis: () => ({ data: ["administrador"] }),
  usePermissoes: () => ({ gerirIntegracao: true, gerirJornada: true, operar: true }),
}));
import { Route as RotaVisao } from "./index";
const VisaoGeral = (RotaVisao as unknown as { component: ComponentType }).component;
import { Route as RotaConfiguracoes } from "./configuracoes";
const Configuracoes = (RotaConfiguracoes as unknown as { component: ComponentType }).component;

afterEach(cleanup);
beforeEach(() => {
  estado.modo = "conta";
  estado.painel = {
    data: {
      contactos: 0,
      marcacoes: 0,
      oportunidades: 0,
      confirmadas: 0,
      elegiveis: 0,
      taxaConfirmacao: null,
      distribuicao: [],
      agenda: {
        hoje: { dia: "2026-09-14", marcacoes: [] },
        amanha: { dia: "2026-09-15", marcacoes: [] },
      },
      periodo: { primeiroDia: "2026-08-16", ultimoDia: "2026-09-14" },
      fuso: "Europe/Lisbon",
      consultadoEm: "2026-09-14T12:00:00Z",
    },
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  };
});
it("conta conectada vazia não recebe pacientes nem KPIs fictícios", () => {
  render(<VisaoGeral />);
  expect(screen.getByText(/Nenhum contacto real/)).toBeTruthy();
  expect(screen.getByText(/Nenhuma marcação ativa importada para hoje/)).toBeTruthy();
  expect(screen.queryByText("82%")).toBeNull();
  expect(screen.queryByText("Modo demonstração")).toBeNull();
  expect(screen.getByText(/Indicadores ainda indisponíveis/)).toBeTruthy();
});
it("falha de leitura não se apresenta como zero nem reapresenta cache antigo", () => {
  estado.painel["isError"] = true;
  render(<VisaoGeral />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Contactos adicionados à base")).toBeNull();
  fireEvent.click(screen.getByText("Tentar novamente"));
  expect(estado.painel["refetch"]).toHaveBeenCalledOnce();
});
it("demo é explícito e não mostra números de conta real", () => {
  estado.modo = "demo";
  render(<VisaoGeral />);
  expect(screen.getByText("Modo demonstração")).toBeTruthy();
  expect(screen.queryByText("Contactos adicionados à base")).toBeNull();
});
it("alterna agenda sem misturar dias e apresenta estado local e contacto ausente", () => {
  const dados = estado.painel["data"] as Record<string, unknown>;
  dados["agenda"] = {
    hoje: {
      dia: "2026-09-14",
      marcacoes: [
        {
          id: "sintetico-1",
          title: "Consulta sintética",
          start_at: "2026-09-14T09:00:00Z",
          status: "confirmada",
          contacts: { full_name: "Pessoa Teste A" },
        },
      ],
    },
    amanha: {
      dia: "2026-09-15",
      marcacoes: [
        {
          id: "sintetico-2",
          title: "Consulta sintética B",
          start_at: "2026-09-15T14:00:00Z",
          status: "sem_resposta",
          contacts: null,
        },
      ],
    },
  };
  render(<VisaoGeral />);
  expect(screen.getByText("Pessoa Teste A")).toBeTruthy();
  expect(screen.getByText("10:00")).toBeTruthy();
  expect(screen.getByText("Estado no app: Confirmada")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Amanhã" }));
  expect(screen.queryByText("Pessoa Teste A")).toBeNull();
  expect(screen.getByText("Contacto por associar")).toBeTruthy();
  expect(screen.getByText("15:00")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Amanhã" }).getAttribute("aria-pressed")).toBe("true");
});
it("exibe quantidade confirmada sem taxa e deixa fontes visíveis com metodologia recolhida", () => {
  const dados = estado.painel["data"] as Record<string, unknown>;
  Object.assign(dados, { confirmadas: 2, elegiveis: 2, marcacoes: 3, taxaConfirmacao: 100 });
  render(<VisaoGeral />);
  const card = screen.getByText("Com estado Confirmada no app").closest("article")!;
  expect(within(card).getByText("2")).toBeTruthy();
  expect(within(card).getByText(/Não comprova resposta SIM/)).toBeTruthy();
  expect(screen.queryByText("100%")).toBeNull();
  expect(screen.getByText(/Fonte: base local da organização, incluindo importações/)).toBeTruthy();
  expect(screen.getByText("Como estes dados são calculados").closest("details")!.open).toBe(false);
});
it("recolhe etapas sem movimento e permite consultar a distribuição completa", () => {
  const dados = estado.painel["data"] as Record<string, unknown>;
  Object.assign(dados, {
    contactos: 2,
    distribuicao: [
      { key: "vazia", nome: "Etapa sem movimento", quantidade: 0 },
      { key: "ativa", nome: "Etapa com contactos", quantidade: 2 },
    ],
  });
  render(<VisaoGeral />);
  expect(screen.getByText("Etapa com contactos")).toBeTruthy();
  expect(screen.queryByText("Etapa sem movimento")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 1 etapa" }));
  expect(screen.getByText("Etapa sem movimento")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar menos etapas" }));
  expect(screen.queryByText("Etapa sem movimento")).toBeNull();
});
it("configurações exibem a equipa consultada e não oferecem salvamento fictício", () => {
  render(<Configuracoes />);
  expect(screen.getByText("Utilizador real (você)")).toBeTruthy();
  expect(screen.getByText("real@teste.invalid")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  expect(document.body.textContent).not.toContain("exemplo.pt");
});
it("clínica e sistema mostram o cadastro e os estados consultados", () => {
  render(<Configuracoes />);
  // Radix activates tabs with pointer down.
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Clínica" }), { button: 0, ctrlKey: false });
  fireEvent.keyDown(screen.getByRole("tab", { name: "Clínica" }), { key: "Enter" });
  expect(screen.getByText("Clínica real de teste")).toBeTruthy();
  expect(screen.getByText("Europe/Lisbon")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Sistema" }), { key: "Enter" });
  expect(screen.getByText("Leitura da organização concluída")).toBeTruthy();
  expect(screen.getByText("Chave configurada; operação não testada")).toBeTruthy();
  expect(screen.queryByText("24 meses")).toBeNull();
});
