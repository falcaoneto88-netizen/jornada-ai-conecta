/** Public capabilities of this build. Private source texts stay in the server-only module. */
export const izabelMetadata = {
  name: "Izabel",
  knowledgeVersion: "V03",
  versionLabel: "V03 · núcleo textual supervisionado",
  packageVersion: "1.0.0",
  contentStatus: "draft_supervised",
  packageStatus: "text_subset_integrated",
  runtimeIntegrated: true,
  availability: "requires_verified_private_library",
  fullProtocolConnected: false,
  mediaConnected: false,
  dependencies: [
    "Validação das respostas com o modelo real e a equipe",
    "Evidências das condições dos textos ainda excluídos",
    "Persistência de fase, recibos e transferência no fluxo supervisionado",
    "Autorizações das imagens e vínculo com o canal",
  ],
  actionLimits: [
    "Aprovação humana obrigatória; nenhuma ampliação de envio",
    "Sem agenda, cobrança, desconto ou transferência autônomos",
    "Textos condicionados sem evidência e mídias ficam indisponíveis",
  ],
} as const;
