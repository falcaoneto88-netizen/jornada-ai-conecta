// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  analisar: vi.fn(),
  corrigir: vi.fn(),
  enviar: vi.fn(),
  contexto: vi.fn(),
  conferir: vi.fn(),
  estado: vi.fn(),
  refetch: vi.fn(),
  escopo: "conta-a",
  error: false,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/ai.functions", () => ({ aiSupport: mocks.analisar }));
vi.mock("@/lib/correcao-texto.functions", () => ({ corrigirRascunho: mocks.corrigir }));
vi.mock("@/lib/commercial-agent.functions", () => ({
  getInboxSendContext: mocks.contexto,
  sendInboxMessage: mocks.enviar,
  getInboxSendStatus: mocks.estado,
  reconcileManualAgentMessage: mocks.conferir,
}));
vi.mock("@/lib/jev-pedidos.functions", () => ({ classificarPedido: vi.fn() }));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: "orgA", timezone: "Europe/Lisbon" } } }),
}));
vi.mock("@/lib/repo", () => ({ useModoDados: () => ({ escopo: mocks.escopo }) }));
vi.mock("@/lib/ghl-observation", () => ({
  useConversasGhl: () => ({
    data: {
      pages: [
        {
          consultadoEm: "2026-09-14T12:00:00Z",
          conversas: ["Ana", "Bruno"].map((nome) => ({
            id: nome,
            contactId: nome,
            locationId: "locA",
            nome,
            ultimaMensagem: "Olá",
            tipo: "SMS",
            ultimaData: "2026-09-14T12:00:00Z",
            naoLidas: 1,
          })),
        },
      ],
    },
    refetch: vi.fn(),
  }),
  useMensagensGhl: (id: string) => ({
    isError: mocks.error,
    error: new Error("Token sem escopo de mensagens"),
    refetch: mocks.refetch,
    data: {
      pages: [
        {
          consultadoEm: "2026-09-14T12:00:00Z",
          mensagens: [
            {
              id: `msg-${id}`,
              texto: "SIM",
              tipo: "SMS",
              direcao: "inbound",
              data: "2026-09-14T12:00:00Z",
              estado: "delivered",
              anexos: 0,
            },
          ],
        },
      ],
    },
  }),
}));
import { GhlInbox, lerIntencao, pendentesEnvio } from "./ghl-inbox";
const REV = {
  historyHash: "a".repeat(64),
  sessionVersion: 1,
  channel: "SMS" as const,
  providerId: "zap",
  defaultId: "zap",
};
function ctx(over: Record<string, unknown> = {}) {
  return {
    name: "Ana",
    channel: "SMS",
    transport: "ZaptosWPP V2",
    sendAllowed: true,
    blockedReason: null,
    revision: REV,
    lastDispatch: null,
    ...over,
  };
}
afterEach(cleanup);
beforeEach(() => {
  for (const f of [
    mocks.analisar,
    mocks.corrigir,
    mocks.enviar,
    mocks.conferir,
    mocks.refetch,
    mocks.estado,
  ])
    f.mockReset();
  mocks.contexto.mockReset().mockResolvedValue({
    ok: true,
    data: ctx(),
  });
  mocks.escopo = "conta-a";
  mocks.error = false;
  pendentesEnvio.clear();
  localStorage.clear();
});
function bruno() {
  fireEvent.click(screen.getByRole("button", { name: /Bruno/ }));
}
it("rascunho não acompanha a troca de conversa nem volta ao reabrir", () => {
  render(<GhlInbox />);
  fireEvent.change(screen.getByLabelText("Rascunho para Ana"), {
    target: { value: "Privado de Ana" },
  });
  bruno();
  expect((screen.getByLabelText("Rascunho para Bruno") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  expect((screen.getByLabelText("Rascunho para Ana") as HTMLTextAreaElement).value).toBe("");
});
it("resultado tardio da IA não contamina o novo atendimento", async () => {
  let resolver!: (data: unknown) => void;
  mocks.analisar.mockImplementation(
    () =>
      new Promise((r) => {
        resolver = r;
      }),
  );
  render(<GhlInbox />);
  fireEvent.click(screen.getByText("Analisar mensagens carregadas"));
  bruno();
  await act(async () =>
    resolver({
      ok: true,
      analise: { resumo: "Resumo privado de Ana", sugestoes: [], revisao_humana: false },
    }),
  );
  expect(screen.queryByText("Resumo privado de Ana")).toBeNull();
  expect((screen.getByLabelText("Rascunho para Bruno") as HTMLTextAreaElement).value).toBe("");
});
it("mudança de conta limpa seleção e rascunhos", () => {
  const { rerender } = render(<GhlInbox />);
  bruno();
  fireEvent.change(screen.getByLabelText("Rascunho para Bruno"), {
    target: { value: "Outra conta" },
  });
  mocks.escopo = "conta-b";
  rerender(<GhlInbox />);
  expect((screen.getByLabelText("Rascunho para Ana") as HTMLTextAreaElement).value).toBe("");
});
it("mensagem SIM exibe fuso e estado sem confirmar consulta ou liberar envio", () => {
  render(<GhlInbox />);
  expect(screen.getByText("Texto recebido: SIM")).toBeTruthy();
  expect(screen.getByText(/Estado no GHL: delivered/).textContent).toContain("13:00");
  expect(mocks.enviar).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /Abrir atendimento/ }).getAttribute("href")).toContain(
    "/locA/contacts/detail/Ana",
  );
});
it("erro de leitura oculta conteúdo antigo e bloqueia nova análise", () => {
  mocks.error = true;
  render(<GhlInbox />);
  expect(screen.getByRole("alert").textContent).toContain("Token sem escopo");
  expect(screen.queryByText("Texto recebido: SIM")).toBeNull();
  expect((screen.getByText("Analisar mensagens carregadas") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

const campo = (n = "Ana") => screen.getByLabelText(`Rascunho para ${n}`) as HTMLTextAreaElement;
const escrever = (t: string, n = "Ana") => fireEvent.change(campo(n), { target: { value: t } });
const flush = () => act(async () => {});
it("Corrigir aplica a correção real no mesmo campo, sem enviar", async () => {
  mocks.corrigir.mockResolvedValue({ ok: true, texto: "Olá, tudo bem?" });
  render(<GhlInbox />);
  escrever("Ola, tudo bem?");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Corrigir/ })));
  expect(mocks.corrigir).toHaveBeenCalledWith({ data: { texto: "Ola, tudo bem?" } });
  expect(campo().value).toBe("Olá, tudo bem?");
  expect(mocks.enviar).not.toHaveBeenCalled();
});
it("edição durante a correção (mesmo voltando ao original) descarta a resposta", async () => {
  let r!: (v: unknown) => void;
  mocks.corrigir.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  escrever("Ola");
  fireEvent.click(screen.getByRole("button", { name: /Corrigir/ }));
  escrever("Ola mudado");
  escrever("Ola");
  await act(async () => r({ ok: true, texto: "Olá" }));
  expect(campo().value).toBe("Ola");
  expect(screen.getByText(/descartada/)).toBeTruthy();
});
it("erro da correção mantém o texto e mostra a mensagem", async () => {
  mocks.corrigir.mockResolvedValue({
    ok: false,
    code: "sem_creditos",
    message: "Sem créditos de IA disponíveis. O texto foi mantido.",
  });
  render(<GhlInbox />);
  escrever("Ola");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Corrigir/ })));
  expect(campo().value).toBe("Ola");
  expect(screen.getByText(/Sem créditos/)).toBeTruthy();
});
it("correção tardia não contamina outra conversa", async () => {
  let r!: (v: unknown) => void;
  mocks.corrigir.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  escrever("Ola");
  fireEvent.click(screen.getByRole("button", { name: /Corrigir/ }));
  bruno();
  await act(async () => r({ ok: true, texto: "Olá" }));
  expect(campo("Bruno").value).toBe("");
});
it("Enviar: um clique envia o texto visível atual; duplo clique não duplica", async () => {
  let r!: (v: unknown) => void;
  mocks.enviar.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  await flush();
  escrever("Texto final  ");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ });
  fireEvent.click(b);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  const arg = mocks.enviar.mock.calls[0]![0].data;
  expect(arg).toMatchObject({
    organizationId: "orgA",
    contactId: "Ana",
    conversationId: "Ana",
    // Texto EXATO visível, com espaços intencionais (sem trim silencioso).
    text: "Texto final  ",
  });
  expect(campo().disabled).toBe(true);
  await act(async () =>
    r({ ok: true, data: { state: "sent", messageId: "m1", code: null, manualId: "x" } }),
  );
  expect(screen.getByText(/aceite pelo GHL \(ID m1\)/)).toBeTruthy();
  expect(mocks.refetch).toHaveBeenCalled();
  expect(campo().value).toBe("");
});
it("falha de rede = incerto, mantém texto e não reenvia automaticamente", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(campo().value).toBe("Mensagem");
  expect(screen.getByText(/não confirmado/)).toBeTruthy();
});
it("falha antes do POST liberta; nova revisão gera nova chave, mesma revisão reutiliza", async () => {
  mocks.enviar.mockResolvedValue({ ok: false, code: "send_disabled" });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  const b = () => screen.getByRole("button", { name: /Enviar para Ana/ });
  await act(async () => fireEvent.click(b()));
  await act(async () => fireEvent.click(b()));
  const [a, c] = mocks.enviar.mock.calls.map((x) => x[0].data.requestId);
  expect(a).toBe(c);
  escrever("Outra");
  await act(async () => fireEvent.click(b()));
  expect(mocks.enviar.mock.calls[2]![0].data.requestId).not.toBe(a);
});
it("bloqueio do servidor (DND/canal/escopo) desativa Enviar com motivo", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: {
      name: "Ana",
      channel: "SMS",
      sendAllowed: false,
      blockedReason: "do_not_contact",
      lastDispatch: null,
    },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/DND ativo/)).toBeTruthy();
});

it("Usar rascunho durante envio pendente é ignorado e não é apagado pelo sucesso", async () => {
  mocks.analisar.mockResolvedValue({
    ok: true,
    analise: {
      resumo: "r",
      revisao_humana: false,
      sugestoes: [{ tom: "objetiva", texto: "Sugestão" }],
    },
  });
  let r!: (v: unknown) => void;
  mocks.enviar.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  await flush();
  await act(async () => fireEvent.click(screen.getByText("Analisar mensagens carregadas")));
  escrever("Texto enviado");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  const usar = screen.getByRole("button", { name: "Usar rascunho" }) as HTMLButtonElement;
  expect(usar.disabled).toBe(true);
  fireEvent.click(usar);
  fireEvent.change(campo(), { target: { value: "edição forçada" } });
  expect(campo().value).toBe("Texto enviado");
  await act(async () =>
    r({ ok: true, data: { state: "sent", messageId: "m1", code: null, manualId: "x" } }),
  );
  expect(campo().value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Usar rascunho" }));
  expect(campo().value).toBe("Sugestão");
});
it("timeout do navegador: edição posterior não liberta novo POST; só leitura recupera", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: { manualId: "m9", state: "sent", messageId: "g9", code: null },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  const id = mocks.enviar.mock.calls[0]![0].data.requestId;
  escrever("Mensagem editada");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Verificar estado/ })));
  expect(mocks.estado).toHaveBeenCalledWith({ data: { organizationId: "orgA", requestId: id } });
  expect(screen.getByText(/aceite pelo GHL \(ID g9\)/)).toBeTruthy();
  expect(campo().value).toBe("Mensagem editada");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
it("envio incerto persiste ao trocar de conversa e voltar", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  expect(screen.getByText(/novos envios ficam bloqueados/)).toBeTruthy();
});
it("duplo clique síncrono produz um único pedido", async () => {
  mocks.enviar.mockImplementation(() => new Promise(() => {}));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ });
  act(() => {
    b.click();
    b.click();
  });
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
it("capacidade atualizada: conversa mudou desde a revisão bloqueia sem renovar sozinha", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({ revision: { ...REV, historyHash: "b".repeat(64) } }),
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
  expect(screen.getByText(/mudou desde que começou a rever/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Conferi as mensagens novas/ }));
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "m", code: null, manualId: "x" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar.mock.calls[0]![0].data.revision.historyHash).toBe("b".repeat(64));
});
it("falha de leitura do contexto torna o envio indisponível", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  mocks.contexto.mockResolvedValue({ ok: false, code: "route_unverified" });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/fornecedor real/)).toBeTruthy();
  expect(screen.getByText(/Transporte: não verificado/)).toBeTruthy();
});
it("colar texto acima do limite não corta; mostra contador e bloqueia envio", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("x".repeat(1600));
  expect(campo().value.length).toBe(1600);
  expect(screen.getByText(/1600\/1500/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("quebras de linha e espaços são enviados exatamente como visíveis", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "m9", code: null, manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  escrever("  Linha 1\n\nLinha 2 ");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar.mock.calls[0]![0].data.text).toBe("  Linha 1\n\nLinha 2 ");
});
it("timeout antes do prepare + lookup null dentro do prazo: continua bloqueado, zero segundo POST", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({ ok: true, data: null });
  render(<GhlInbox />);
  await flush();
  escrever("Texto A");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(screen.getByText(/não prova que nada foi enviado/)).toBeTruthy();
  escrever("Texto B");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
it("lookup null NUNCA liberta por tempo (entrada HTTP pode chegar >90s depois): zero segundo POST", async () => {
  const agora = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(agora);
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({ ok: true, data: null });
  render(<GhlInbox />);
  await flush();
  escrever("Texto A");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  spy.mockReturnValue(agora + 3600_000); // relógio muito adiantado
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(screen.getByText(/não prova que nada foi enviado/)).toBeTruthy();
  expect(screen.queryByText(/Nada foi enviado/)).toBeNull();
  expect(screen.getByText(/Resultado do envio não confirmado/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
it("prepared com relógio do navegador adiantado/expirado continua bloqueado; não há retomada de texto oculto", async () => {
  mocks.enviar.mockRejectedValueOnce(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: {
      state: "prepared",
      manualId: "11111111-1111-4111-8111-111111111111",
      messageId: null,
      code: null,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Texto capturado");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(screen.getByText(/ainda não enviado. O pedido original ainda pode ser processado/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Retomar/ })).toBeNull();
  escrever("Texto editado depois");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(campo().value).toBe("Texto editado depois");
});
it("rejeição definitiva: novo clique com o MESMO texto gera nova intenção explícita", async () => {
  mocks.enviar
    .mockResolvedValueOnce({
      ok: true,
      data: { state: "rejected", messageId: null, code: "forbidden", manualId: "x" },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { state: "sent", messageId: "m3", code: null, manualId: "y" },
    });
  render(<GhlInbox />);
  await flush();
  escrever("Mesmo texto");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(campo().value).toBe("Mesmo texto");
  expect(screen.queryByText(/nada foi enviado/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar).toHaveBeenCalledTimes(2);
  const [a, b] = mocks.enviar.mock.calls.map((c) => c[0].data);
  expect(b.requestId).not.toBe(a.requestId);
  expect(b.text).toBe("Mesmo texto");
});
it("invalidated vira draft_stale: preserva texto e exige leitura atualizada", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "invalidated", messageId: null, code: null, manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  const leituras = mocks.contexto.mock.calls.length;
  escrever("Texto mantido");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(
    screen.getByText(/A conversa mudou. Atualize as mensagens; o texto foi mantido/),
  ).toBeTruthy();
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  expect(campo().value).toBe("Texto mantido");
  expect(mocks.contexto.mock.calls.length).toBeGreaterThan(leituras);
});
it("recarregar a página não contorna envio incerto (intenção mínima persistida, sem texto)", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  const { unmount } = render(<GhlInbox />);
  await flush();
  escrever("Texto clínico não persistido");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  const gravado = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
  expect(gravado).not.toContain("Texto clínico");
  unmount();
  pendentesEnvio.clear(); // simula recarregar: memória perdida
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/Resultado do envio não confirmado/)).toBeTruthy();
  escrever("Outro");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(lerIntencao("orgA:Ana:Ana")?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
it("Instagram elegível: informa que a conexão é validada no envio; recusa 403 preserva texto", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({
      channel: "IG",
      transport: "Instagram (integração nativa)",
      connectionVerifiedAtSend: true,
      revision: { ...REV, channel: "IG", providerId: null, defaultId: null },
    }),
  });
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "rejected", messageId: null, code: "forbidden_provider", manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/conexão e a permissão serão validadas pelo GHL no envio/)).toBeTruthy();
  escrever("Olá pelo Instagram");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar.mock.calls[0]![0].data.revision.channel).toBe("IG");
  expect(screen.getByText(/GHL recusou este envio/)).toBeTruthy();
  expect(campo().value).toBe("Olá pelo Instagram");
});
it("canal fora da janela mostra motivo verdadeiro (24h)", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({ channel: "IG", sendAllowed: false, blockedReason: "channel_window" }),
  });
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/mais de 24 horas/)).toBeTruthy();
});
