import { describe, expect, it } from "vitest";
import type { Marcacao } from "./repo";
import {
  agendaGhlUrl,
  estadoAdministrativo,
  filtrarAgenda,
  previaConfirmacao,
  resumoValores,
} from "./agenda-workspace";
const m: Marcacao = {
  id: "a",
  cliente: "João Exemplo",
  titulo: "Avaliação inicial",
  clienteId: "local-1",
  clienteGhlId: "ghl-1",
  inicioIso: "2026-09-14T23:30:00Z",
  inicio: "",
  fim: null,
  estado: "confirmada",
  responsavel: "Equipa A",
};
describe("agenda integrada", () => {
  it("busca por acento e combina responsável e estado", () => {
    expect(filtrarAgenda([m], "joao", "confirmada", "Equipa A")).toEqual([m]);
    expect(filtrarAgenda([m], "avaliacao", "cancelada", "todos")).toEqual([]);
    expect(
      filtrarAgenda([m, { ...m, id: "b", responsavel: null }], "", "todos", "sem-responsavel").map(
        (v) => v.id,
      ),
    ).toEqual(["b"]);
  });
  it("estado importado não se apresenta como presença confirmada", () => {
    expect(estadoAdministrativo("confirmada")).toBe("Agendada");
  });
  it("ausência de valores fica desconhecida e não quitada", () => {
    const r = resumoValores([m], []);
    expect(r).toMatchObject({ known: 0, eligible: 1 });
  });
  it("exclui cancelamentos e outros compromissos, e não duplica montantes", () => {
    const entries = [
      { appointmentId: "a", totalCents: 101, depositCents: 10 },
      { appointmentId: "b", totalCents: 30000, depositCents: 900 },
      { appointmentId: "outro", totalCents: 10000, depositCents: 10000 },
    ];
    expect(
      resumoValores([m, { ...m, id: "b", estado: "cancelada" }], [...entries, entries[0]!]),
    ).toEqual({ totalCents: 101, depositCents: 10, remainingCents: 91, known: 1, eligible: 1 });
  });
  it("prévia usa data e horário de Lisboa e não inventa valor ausente", () => {
    const copy = structuredClone(m);
    const text = previaConfirmacao(m, "Europe/Lisbon");
    expect(text).toContain("15/09/26");
    expect(text).toContain("00:30");
    expect(text).not.toContain("sinal");
    expect(text).not.toContain("enviada");
    expect(m).toEqual(copy);
  });
  it("valores opcionais são identificados como informados", () => {
    const text = previaConfirmacao(m, "Europe/Lisbon", {
      appointmentId: "a",
      totalCents: 160000,
      depositCents: 50000,
    });
    expect(text).toContain("sinal informado");
    expect(text).not.toContain("já pago");
  });
  it("link de agenda deriva apenas da conexão e rejeita caminhos injetados", () => {
    expect(agendaGhlUrl(null, "c")).toBeNull();
    expect(agendaGhlUrl("x/../../", "c")).toBeNull();
    expect(agendaGhlUrl("local", "calendar")).toBe(
      "https://app.gohighlevel.com/v2/location/local/calendars/view?calendar_ids=calendar",
    );
  });
});
