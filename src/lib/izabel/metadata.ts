/** Public status only. Never import the private instruction or package contents here. */
export const izabelMetadata = {
  name: "Izabel",
  versionLabel: "v1.0.0 · em homologação",
  contentStatus: "draft_supervised",
  packageStatus: "received_validated",
  runtimeConnected: false,
  dependencies: [
    "Homologação do interpretador semântico com o modelo real",
    "Persistência de fase, recibos e transferência no fluxo supervisionado",
    "Autorizações de uso das oito imagens e vínculo com o canal",
    "Revisão e publicação antes de ativar a nova base",
  ],
  actionLimits: [
    "Prévia local; aprovação humana obrigatória",
    "Sem envio a contatos reais, publicação ou ampliação de autonomia",
    "Sem acesso à agenda, cobrança, desconto ou confirmação de agendamento",
    "Imagens sem autorização ou transporte permanecem indisponíveis",
    "Nenhuma mudança no worker, provider ou permissões existentes",
  ],
} as const;
