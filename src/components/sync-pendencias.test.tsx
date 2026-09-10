// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SyncPendencias } from "./sync-pendencias";
afterEach(cleanup);
it("mostra os identificadores e motivos de cada pendência", () => {
  render(
    <SyncPendencias
      pendencias={[
        { contactId: "contato-a", code: "sem_versao", message: "Data ausente." },
        { contactId: "contato-b", code: "conflito_telefone", message: "Telefone em conflito." },
      ]}
    />,
  );
  expect(screen.getByText("contato-a")).toBeTruthy();
  expect(screen.getByText("contato-b")).toBeTruthy();
  expect(screen.getByText(/Data ausente/)).toBeTruthy();
  expect(screen.getByText(/Telefone em conflito/)).toBeTruthy();
});
it("não inventa identificador para identidade não confirmada", () => {
  render(
    <SyncPendencias
      pendencias={[
        { contactId: null, code: "identidade_divergente", message: "Identidade divergente." },
      ]}
    />,
  );
  expect(screen.getByText(/identificador oculto por segurança/)).toBeTruthy();
  expect(screen.queryByText(/ID do contacto:/)).toBeNull();
});
