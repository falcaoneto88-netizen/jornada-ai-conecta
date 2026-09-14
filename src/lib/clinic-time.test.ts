import { describe, expect, it } from "vitest";
import {
  chaveCelula,
  chaveDia,
  diaCivil,
  formatarDataHora,
  formatarHora,
  inicioDiaUtc,
  intervaloDias,
  validarFuso,
} from "./clinic-time";

describe("horário da clínica", () => {
  it("mostra a consulta às 13h de Lisboa, independentemente do navegador", () => {
    expect(formatarHora("2026-09-15T12:00:00Z", "Europe/Lisbon")).toBe("13:00");
    expect(formatarHora("2026-09-15T12:00:00Z", "America/Bahia")).toBe("09:00");
    expect(formatarDataHora("2026-09-15T12:00:00Z", "Europe/Lisbon")).toContain("13:00");
  });
  it("agrupa na data de Lisboa quando o Brasil ainda está no dia anterior", () => {
    const instante = "2026-09-14T23:30:00Z";
    expect(chaveDia(instante, "Europe/Lisbon")).toBe("2026-09-15");
    expect(chaveDia(instante, "America/Bahia")).toBe("2026-09-14");
    expect(chaveCelula(diaCivil(instante, "Europe/Lisbon"))).toBe("2026-09-15");
  });
  it.each([
    ["2026-03-29", "2026-03-30", 23],
    ["2026-10-25", "2026-10-26", 25],
  ])("respeita o dia %s com transição de verão", (inicio, fim, horas) => {
    expect(
      (Date.parse(inicioDiaUtc(fim, "Europe/Lisbon")) -
        Date.parse(inicioDiaUtc(inicio, "Europe/Lisbon"))) /
        3_600_000,
    ).toBe(horas);
  });
  it("não desloca nem perde as duas ocorrências da hora repetida", () => {
    expect(formatarHora("2026-10-25T00:30:00Z", "Europe/Lisbon")).toBe("01:30");
    expect(formatarHora("2026-10-25T01:30:00Z", "Europe/Lisbon")).toBe("01:30");
    expect(chaveDia("2026-10-25T01:30:00Z", "Europe/Lisbon")).toBe("2026-10-25");
  });
  it("filtra sete datas civis incluindo hoje em Lisboa e exclui o limite final", () => {
    expect(intervaloDias(7, new Date("2026-09-14T23:30:00Z"), "Europe/Lisbon")).toEqual({
      primeiroDia: "2026-09-09",
      ultimoDia: "2026-09-15",
      inicio: "2026-09-08T23:00:00.000Z",
      fim: "2026-09-15T23:00:00.000Z",
    });
  });
  it("recusa fuso inválido em vez de assumir o fuso do navegador", () => {
    expect(() => validarFuso("Portugal/Falso")).toThrow(/fuso horário/);
  });
});
