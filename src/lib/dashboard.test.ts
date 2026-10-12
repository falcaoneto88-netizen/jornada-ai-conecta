import { expect, it, vi } from "vitest";
import { intervalosAgendaPainel, lerPaginas, resumirPainel } from "./dashboard";

it("hoje e amanhã seguem a data da clínica mesmo antes da meia-noite UTC", () => {
  expect(intervalosAgendaPainel(new Date("2026-10-11T23:30:00Z"), "Europe/Lisbon")).toEqual({
    hoje: {
      dia: "2026-10-12",
      inicio: "2026-10-11T23:00:00.000Z",
      fim: "2026-10-12T23:00:00.000Z",
    },
    amanha: {
      dia: "2026-10-13",
      inicio: "2026-10-12T23:00:00.000Z",
      fim: "2026-10-13T23:00:00.000Z",
    },
  });
});
it.each([
  ["2026-03-29T12:00:00Z", 23],
  ["2026-10-25T12:00:00Z", 25],
])("a agenda respeita o dia com mudança de horário em %s", (agora, horas) => {
  const { hoje, amanha } = intervalosAgendaPainel(new Date(agora), "Europe/Lisbon");
  expect((Date.parse(hoje.fim) - Date.parse(hoje.inicio)) / 3_600_000).toBe(horas);
  expect(amanha.inicio).toBe(hoje.fim);
});

it("distingue ausência de denominador de taxa zero", () => {
  expect(resumirPainel([], [], 0, []).taxaConfirmacao).toBeNull();
  expect(resumirPainel([], [{ id: "x", status: "faltou" }], 0, []).taxaConfirmacao).toBe(0);
});
it("exclui canceladas/inválidas do denominador e preserva outras etapas locais", () => {
  const resultado = resumirPainel(
    [
      { id: "a", stage_key: "novo_lead" },
      { id: "b", stage_key: "outra" },
    ],
    [
      { id: "1", status: "confirmada" },
      { id: "2", status: "faltou" },
      { id: "3", status: "cancelada" },
      { id: "4", status: "invalid" },
    ],
    3,
    [{ key: "novo_lead", name: "Novo Lead" }],
  );
  expect(resultado).toMatchObject({
    contactos: 2,
    marcacoes: 4,
    oportunidades: 3,
    confirmadas: 1,
    elegiveis: 2,
    taxaConfirmacao: 50,
  });
  expect(resultado.distribuicao.reduce((total, e) => total + e.quantidade, 0)).toBe(2);
});
it("lê além de mil registos sem truncar os indicadores", async () => {
  const registros = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const fonte = vi.fn(async (inicio, fim) => ({
    data: registros.slice(inicio, fim + 1),
    error: null,
  }));
  expect(await lerPaginas(fonte)).toHaveLength(1203);
  expect(fonte).toHaveBeenCalledTimes(3);
});
it("uma falha a meio não devolve um KPI parcial", async () => {
  const fonte = vi.fn(async (inicio: number) =>
    inicio === 0
      ? { data: Array(500).fill({ id: 1 }), error: null }
      : { data: null, error: { message: "Falha na consulta" } },
  );
  await expect(lerPaginas(fonte)).rejects.toThrow("Falha na consulta");
});
