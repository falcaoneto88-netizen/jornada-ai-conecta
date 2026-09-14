// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/repo", () => ({ rotuloEstadoMarcacao: (estado: string) => estado }));
import { AgendaCalendario } from "./agenda-calendario";
import { diaCivil } from "@/lib/clinic-time";
afterEach(cleanup);
it.each(["dia", "semana", "mes"] as const)(
  "a vista %s exibe a consulta na data de Lisboa, após a meia-noite",
  (vista) => {
    render(
      <AgendaCalendario
        vista={vista}
        fuso="Europe/Lisbon"
        dataReferencia={diaCivil("2026-09-14T23:30:00Z", "Europe/Lisbon")}
        marcacoes={[
          {
            id: "teste",
            cliente: "Cliente teste",
            titulo: "Consulta",
            clienteId: "a",
            inicioIso: "2026-09-14T23:30:00Z",
            inicio: "",
            fim: null,
            estado: "confirmada",
            responsavel: null,
          },
        ]}
        onSelecionar={() => {}}
        onAbrirDia={() => {}}
      />,
    );
    expect(screen.getByText("00:30")).toBeTruthy();
    expect(screen.getByText(/Cliente teste/)).toBeTruthy();
  },
);
