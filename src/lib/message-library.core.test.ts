import { describe, it, expect } from "vitest";
import {
  analisarVariaveis,
  contextoDaConsulta,
  migrarVariaveisAntigas,
  previsualizarModelo,
  preservarVariaveis,
  salvarModeloSchema,
} from "./message-library.core";
import { modelosIniciais } from "./message-library.starters";
const org = "10000000-0000-4000-8000-000000000001";
describe("biblioteca e variáveis", () => {
  it("oito rascunhos iniciais válidos, únicos e sem variáveis antigas", () => {
    expect(modelosIniciais).toHaveLength(8);
    expect(new Set(modelosIniciais.map((m) => m.starter_key)).size).toBe(8);
    for (const { starter_key: _key, ...draft } of modelosIniciais) {
      expect(
        salvarModeloSchema.safeParse({
          organizationId: org,
          id: org,
          expectedRevision: null,
          draft,
        }).success,
      ).toBe(true);
      expect(draft.lifecycle).toBe("draft");
      expect(migrarVariaveisAntigas(draft.body)).toBe(draft.body);
    }
  });
  it.each([
    "{{appointment.time}}",
    "{{appointment.date}}",
    "{{clinic.name}}",
    "{{arbitrary}}",
    "{{contact.first_name}",
    "{{}}",
    "{{contact.name}}}",
  ])("recusa variável inválida %s", (body) => {
    const v = analisarVariaveis(body);
    expect(v.invalidas.length > 0 || v.malformadas).toBe(true);
  });
  it("migração de nomes é explícita e preserva o resto do texto", () => {
    expect(
      migrarVariaveisAntigas("Olá {{contact.name}} {{appointment.time}} {{clinic.name}}"),
    ).toBe("Olá {{contact.name}} {{appointment.only_start_time}} {{location.name}}");
  });
  it("ausência de contato e data gera pendência, sem fallback fictício", () => {
    const ctx = contextoDaConsulta(
      { start_at: "inválido", title: null, assigned_user_name: null },
      null,
      "Clínica",
      "Europe/Lisbon",
    );
    const p = previsualizarModelo(
      "{{contact.first_name}} {{appointment.start_time}} {{appointment.user.name}}",
      ctx,
    );
    expect(p.completo).toBe(false);
    expect(p.ausentes).toHaveLength(3);
    expect(p.texto).not.toContain("Ana");
  });
  it("data e hora usam o fuso da clínica e não do navegador", () => {
    const a = { start_at: "2026-09-15T13:00:00Z", title: "Consulta", assigned_user_name: null };
    expect(
      contextoDaConsulta(a, "Nome Exemplo", "Clínica", "Europe/Lisbon")[
        "appointment.only_start_time"
      ],
    ).toBe("14:00");
    expect(
      contextoDaConsulta(a, "Nome Exemplo", "Clínica", "America/Bahia")[
        "appointment.only_start_time"
      ],
    ).toBe("10:00");
  });
  it("não interpreta variáveis dentro de valores de cadastro", () => {
    expect(
      previsualizarModelo("Olá {{contact.name}}", {
        "contact.name": "Teste {{appointment.start_time}}",
      }).texto,
    ).toBe("Olá Teste {{appointment.start_time}}");
  });
  it("IA pode mudar prosa mantendo a contagem e o texto exato das variáveis", () => {
    expect(preservarVariaveis("Oi {{contact.name}}", "Olá {{contact.name}}!")).toBe(true);
    expect(preservarVariaveis("{{contact.name}} {{contact.name}}", "{{contact.name}}")).toBe(false);
    expect(preservarVariaveis("{{contact.name}}", "{{contact.first_name}}")).toBe(false);
    expect(preservarVariaveis("{{contact.name}}", "{{ contact.name }}")).toBe(false);
    expect(preservarVariaveis("Texto", "Texto {{appointment.time}}")).toBe(false);
  });
});
