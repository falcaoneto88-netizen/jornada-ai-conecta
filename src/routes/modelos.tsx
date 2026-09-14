import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MessageLibrary } from "@/components/message-library";
export const Route = createFileRoute("/modelos")({
  head: () => ({
    meta: [
      { title: "Modelos de Mensagem — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Biblioteca de rascunhos por etapa, canal e idioma, com prévia validada e dados da consulta.",
      },
    ],
  }),
  component: Modelos,
});
function Modelos() {
  return (
    <AppShell
      title="Modelos de Mensagem"
      description="Biblioteca de rascunhos e pré-visualização para revisão"
    >
      <MessageLibrary />
    </AppShell>
  );
}
