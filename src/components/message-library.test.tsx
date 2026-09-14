// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ler: vi.fn(),
  contexto: vi.fn(),
  salvar: vi.fn(),
  ia: vi.fn(),
  pode: true,
  escopo: "a",
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/message-library.functions", () => ({
  getMessageLibrary: m.ler,
  getMessageTemplateContext: m.contexto,
  saveMessageTemplateDraft: m.salvar,
}));
vi.mock("@/lib/ai.functions", () => ({ melhorarTexto: m.ia }));
vi.mock("@/lib/repo", () => ({
  useModoDados: () => ({ demo: false, escopo: m.escopo }),
  usePermissoes: () => ({ gerirJornada: m.pode }),
}));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({
    data: {
      organizacao: { id: "10000000-0000-4000-8000-000000000001", timezone: "Europe/Lisbon" },
    },
  }),
}));
import { MessageLibrary } from "./message-library";
import { modelosIniciais } from "@/lib/message-library.starters";
const data = {
  modelos: [
    {
      ...modelosIniciais[0],
      id: "10000000-0000-4000-8000-000000000002",
      revision: 1,
      updated_at: "2026-09-14T12:00:00Z",
    },
  ],
  etapas: [{ key: "consulta_agendada", name: "Consulta agendada" }],
  consultas: [
    { id: "a", title: "Consulta A", start_at: "2026-09-15T13:00:00Z" },
    { id: "b", title: "Consulta B", start_at: "2026-09-16T13:00:00Z" },
  ],
  consultasLimitadas: false,
};
let qc: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  m.pode = true;
  m.escopo = "a";
  m.ler.mockResolvedValue(data);
  m.salvar.mockResolvedValue({ revision: 2 });
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
});
const app = () => (
  <QueryClientProvider client={qc}>
    <MessageLibrary />
  </QueryClientProvider>
);
async function abrir() {
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Editar e pré-visualizar" }));
}
it("biblioteca vazia permite criar e não envia dados antes de salvar", async () => {
  m.ler.mockResolvedValue({ ...data, modelos: [] });
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Novo modelo" }));
  expect(
    (screen.getByRole("button", { name: "Salvar rascunho" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "Novo" } });
  fireEvent.change(screen.getByLabelText("Texto da mensagem"), {
    target: { value: "Olá {{contact.first_name}}" },
  });
  expect(m.salvar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await waitFor(() => expect(m.salvar).toHaveBeenCalledTimes(1));
  expect(m.salvar.mock.calls[0]![0].data).toMatchObject({
    expectedRevision: null,
    draft: { name: "Novo", lifecycle: "draft" },
  });
});
it("exemplo fictício não pode ser copiado como mensagem preenchida", async () => {
  await abrir();
  expect(screen.getByText("EXEMPLO FICTÍCIO")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Copiar texto preenchido" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("duplicar gera outro ID e inicia revisão nova", async () => {
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Duplicar Agendamento recebido" }));
  expect((screen.getByLabelText("Nome do modelo") as HTMLInputElement).value).toContain("cópia");
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await waitFor(() => expect(m.salvar).toHaveBeenCalledTimes(1));
  const p = m.salvar.mock.calls[0]![0].data;
  expect(p.id).not.toBe(data.modelos[0]!.id);
  expect(p.expectedRevision).toBeNull();
});
it("arquivamento mantém ID e exige revisão atual", async () => {
  await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));
  await waitFor(() => expect(m.salvar).toHaveBeenCalledTimes(1));
  expect(m.salvar.mock.calls[0]![0].data).toMatchObject({
    id: data.modelos[0]!.id,
    expectedRevision: 1,
    draft: { lifecycle: "archived" },
  });
});
it("visualizador pode ler mas não editar ou usar IA", async () => {
  m.pode = false;
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Ver modelo" }));
  expect(screen.queryByRole("button", { name: "Novo modelo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sugerir melhoria com IA" })).toBeNull();
  expect(screen.getByLabelText("Nome do modelo").closest("fieldset")?.disabled).toBe(true);
});
it("troca de consulta retira prévia anterior enquanto busca e em erro", async () => {
  m.contexto.mockResolvedValueOnce({
    values: {
      "contact.first_name": "Real",
      "appointment.only_start_date": "15/09/2026",
      "appointment.only_start_time": "14:00",
      "appointment.timezone": "Europe/Lisbon",
    },
    status: "agendada",
    consultadoEm: "2026-09-14T12:00:00Z",
  });
  await abrir();
  fireEvent.change(screen.getByLabelText("Dados para a prévia"), { target: { value: "a" } });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Copiar texto preenchido" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  m.contexto.mockRejectedValueOnce(new Error("Consulta indisponível"));
  fireEvent.change(screen.getByLabelText("Dados para a prévia"), { target: { value: "b" } });
  expect(
    (screen.getByRole("button", { name: "Copiar texto preenchido" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((await screen.findByRole("alert")).textContent).toBe("Consulta indisponível");
  expect(screen.queryByText(/Olá, Real/)).toBeNull();
});
it("variável desconhecida bloqueia salvamento", async () => {
  await abrir();
  fireEvent.change(screen.getByLabelText("Texto da mensagem"), {
    target: { value: "{{appointment.time}}" },
  });
  expect(
    (screen.getByRole("button", { name: "Salvar rascunho" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Substituir variáveis antigas de data, hora e clínica" }),
  );
  expect((screen.getByLabelText("Texto da mensagem") as HTMLTextAreaElement).value).toBe(
    "{{appointment.only_start_time}}",
  );
});
it("resposta tardia de IA não substitui edição nova", async () => {
  let resolve!: (r: unknown) => void;
  m.ia.mockImplementation(() => new Promise((r) => (resolve = r)));
  await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Sugerir melhoria com IA" }));
  fireEvent.change(screen.getByLabelText("Texto da mensagem"), {
    target: { value: "Minha edição {{contact.name}}" },
  });
  resolve({ ok: true, texto: "Olá {{contact.name}}" });
  await waitFor(() => expect(screen.queryByText("A sugerir…")).toBeNull());
  expect((screen.getByLabelText("Texto da mensagem") as HTMLTextAreaElement).value).toBe(
    "Minha edição {{contact.name}}",
  );
  expect(screen.queryByText("Sugestão da IA — ainda não aplicada")).toBeNull();
});
it("IA que remove variáveis é recusada sem alterar texto", async () => {
  m.ia.mockResolvedValue({ ok: true, texto: "Olá" });
  await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Sugerir melhoria com IA" }));
  expect((await screen.findByRole("alert")).textContent).toContain("IA alterou variáveis");
  expect((screen.getByLabelText("Texto da mensagem") as HTMLTextAreaElement).value).toBe(
    data.modelos[0]!.body,
  );
});
it("salvamento tardio não fecha um novo modelo aberto", async () => {
  let resolve!: (r: unknown) => void;
  m.salvar.mockImplementation(() => new Promise((r) => (resolve = r)));
  await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Novo modelo" }));
  fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "Outra edição" } });
  resolve({ revision: 2 });
  await waitFor(() => expect(m.ler).toHaveBeenCalledTimes(2));
  expect((screen.getByLabelText("Nome do modelo") as HTMLInputElement).value).toBe("Outra edição");
});
it("mudança de identidade fecha edição anterior", async () => {
  const { rerender } = render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Editar e pré-visualizar" }));
  m.escopo = "b";
  rerender(app());
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("erro de leitura é visível e não mostra biblioteca vazia", async () => {
  m.ler.mockRejectedValue(new Error("Offline"));
  render(app());
  expect((await screen.findByRole("alert")).textContent).toContain("Offline");
  expect(screen.queryByRole("button", { name: "Novo modelo" })).toBeNull();
});
