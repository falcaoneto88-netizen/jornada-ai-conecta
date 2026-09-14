// @vitest-environment jsdom
import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
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
      proximas: [],
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
  expect(screen.getByText("—")).toBeTruthy();
  expect(screen.queryByText("82%")).toBeNull();
  expect(screen.queryByText("Modo demonstração")).toBeNull();
  expect(screen.getByText(/Indicadores ainda indisponíveis/)).toBeTruthy();
});
it("falha de leitura não se apresenta como zero nem reapresenta cache antigo", () => {
  estado.painel["isError"] = true;
  render(<VisaoGeral />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Contactos adicionados")).toBeNull();
  fireEvent.click(screen.getByText("Tentar novamente"));
  expect(estado.painel["refetch"]).toHaveBeenCalledOnce();
});
it("demo é explícito e não mostra números de conta real", () => {
  estado.modo = "demo";
  render(<VisaoGeral />);
  expect(screen.getByText("Modo demonstração")).toBeTruthy();
  expect(screen.queryByText("Contactos adicionados")).toBeNull();
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
