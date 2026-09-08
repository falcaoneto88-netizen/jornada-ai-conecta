/**
 * Dados de DEMONSTRAÇÃO — Jornada AI, Dr. João Falcão.
 * Todos os registos são fictícios e estão marcados como DEMO.
 * Nenhum dado real de paciente deve ser colocado neste ficheiro.
 */

export type StageId =
  | "novo_lead"
  | "em_atendimento"
  | "consulta_agendada"
  | "consulta_confirmada"
  | "consulta_realizada"
  | "orcamento_enviado"
  | "procedimento_agendado"
  | "pos_procedimento"
  | "follow_up"
  | "reativacao";

export type JourneyStage = {
  id: StageId;
  nome: string;
  ghlPipelineId: string | null;
  ghlStageId: string | null;
};

export const journeyStages: JourneyStage[] = [
  { id: "novo_lead", nome: "Novo Lead", ghlPipelineId: null, ghlStageId: null },
  { id: "em_atendimento", nome: "Em Atendimento", ghlPipelineId: null, ghlStageId: null },
  { id: "consulta_agendada", nome: "Consulta Agendada", ghlPipelineId: null, ghlStageId: null },
  { id: "consulta_confirmada", nome: "Consulta Confirmada", ghlPipelineId: null, ghlStageId: null },
  { id: "consulta_realizada", nome: "Consulta Realizada", ghlPipelineId: null, ghlStageId: null },
  { id: "orcamento_enviado", nome: "Orçamento Enviado", ghlPipelineId: null, ghlStageId: null },
  { id: "procedimento_agendado", nome: "Procedimento Agendado", ghlPipelineId: null, ghlStageId: null },
  { id: "pos_procedimento", nome: "Pós-Procedimento", ghlPipelineId: null, ghlStageId: null },
  { id: "follow_up", nome: "Follow-up", ghlPipelineId: null, ghlStageId: null },
  { id: "reativacao", nome: "Reativação", ghlPipelineId: null, ghlStageId: null },
];

export type Canal = "whatsapp" | "instagram" | "facebook" | "email";

export const canalLabel: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "E-mail",
};

export type Contact = {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  etapa: StageId;
  tags: string[];
  origem: string;
  canal: Canal;
  responsavel: string;
  proximaAcao: string;
  ultimaInteracao: string; // DD/MM/AAAA
  agendamento: string | null;
  timeline: { data: string; titulo: string; detalhe: string }[];
};

export const contacts: Contact[] = [
  {
    id: "c1",
    nome: "Mariana Coelho",
    telefone: "+351 912 445 108",
    email: "mariana.coelho@exemplo.pt",
    etapa: "novo_lead",
    tags: ["DEMO", "Emagrecimento"],
    origem: "Instagram Ads",
    canal: "instagram",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Primeiro contacto em até 15 min",
    ultimaInteracao: "04/09/2026",
    agendamento: null,
    timeline: [
      { data: "04/09/2026", titulo: "Lead criado", detalhe: "Origem: campanha Instagram — Emagrecimento" },
      { data: "04/09/2026", titulo: "Mensagem recebida", detalhe: "Pediu informação sobre acompanhamento" },
    ],
  },
  {
    id: "c2",
    nome: "Ricardo Antunes",
    telefone: "+55 11 98844 2210",
    email: "ricardo.antunes@exemplo.com.br",
    etapa: "em_atendimento",
    tags: ["DEMO", "Bioimpedância"],
    origem: "Indicação",
    canal: "whatsapp",
    responsavel: "Sofia Marques",
    proximaAcao: "Enviar horários disponíveis",
    ultimaInteracao: "03/09/2026",
    agendamento: null,
    timeline: [
      { data: "02/09/2026", titulo: "Lead criado", detalhe: "Indicação de paciente ativo" },
      { data: "03/09/2026", titulo: "Conversa iniciada", detalhe: "Interesse em avaliação de composição corporal" },
    ],
  },
  {
    id: "c3",
    nome: "Beatriz Salgado",
    telefone: "+351 936 220 741",
    email: "beatriz.salgado@exemplo.pt",
    etapa: "consulta_agendada",
    tags: ["DEMO", "Primeira consulta"],
    origem: "Google",
    canal: "whatsapp",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Confirmar consulta D-1",
    ultimaInteracao: "03/09/2026",
    agendamento: "08/09/2026 10:30",
    timeline: [
      { data: "01/09/2026", titulo: "Lead criado", detalhe: "Pesquisa orgânica" },
      { data: "03/09/2026", titulo: "Consulta agendada", detalhe: "08/09/2026 às 10:30 — Consultório Lisboa" },
    ],
  },
  {
    id: "c4",
    nome: "Tiago Ferreira",
    telefone: "+351 967 118 302",
    email: "tiago.ferreira@exemplo.pt",
    etapa: "consulta_confirmada",
    tags: ["DEMO", "Alta performance"],
    origem: "Indicação",
    canal: "whatsapp",
    responsavel: "Sofia Marques",
    proximaAcao: "Preparar relatório corporal",
    ultimaInteracao: "04/09/2026",
    agendamento: "05/09/2026 09:00",
    timeline: [
      { data: "28/08/2026", titulo: "Consulta agendada", detalhe: "05/09/2026 às 09:00" },
      { data: "04/09/2026", titulo: "Consulta confirmada", detalhe: "Confirmação via WhatsApp" },
    ],
  },
  {
    id: "c5",
    nome: "Helena Prazeres",
    telefone: "+351 913 887 654",
    email: "helena.prazeres@exemplo.pt",
    etapa: "orcamento_enviado",
    tags: ["DEMO", "Estética"],
    origem: "Instagram",
    canal: "email",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Follow-up do orçamento (D+2)",
    ultimaInteracao: "02/09/2026",
    agendamento: null,
    timeline: [
      { data: "30/08/2026", titulo: "Consulta realizada", detalhe: "Avaliação inicial concluída" },
      { data: "02/09/2026", titulo: "Orçamento enviado", detalhe: "Protocolo de acompanhamento — 3 meses" },
    ],
  },
  {
    id: "c6",
    nome: "Nuno Barbosa",
    telefone: "+351 934 002 519",
    email: "nuno.barbosa@exemplo.pt",
    etapa: "procedimento_agendado",
    tags: ["DEMO"],
    origem: "Facebook",
    canal: "facebook",
    responsavel: "Sofia Marques",
    proximaAcao: "Enviar acolhimento pré-procedimento",
    ultimaInteracao: "01/09/2026",
    agendamento: "12/09/2026 15:00",
    timeline: [
      { data: "26/08/2026", titulo: "Orçamento aprovado", detalhe: "Protocolo metabólico" },
      { data: "01/09/2026", titulo: "Procedimento agendado", detalhe: "12/09/2026 às 15:00" },
    ],
  },
  {
    id: "c7",
    nome: "Carla Meireles",
    telefone: "+55 21 99712 4408",
    email: "carla.meireles@exemplo.com.br",
    etapa: "pos_procedimento",
    tags: ["DEMO", "Acompanhamento"],
    origem: "Indicação",
    canal: "whatsapp",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Contacto D+2",
    ultimaInteracao: "03/09/2026",
    agendamento: null,
    timeline: [
      { data: "03/09/2026", titulo: "Procedimento realizado", detalhe: "Sem intercorrências registadas pela equipa" },
    ],
  },
  {
    id: "c8",
    nome: "Pedro Vasconcelos",
    telefone: "+351 915 330 774",
    email: "pedro.vasconcelos@exemplo.pt",
    etapa: "follow_up",
    tags: ["DEMO", "Evolução corporal"],
    origem: "Google",
    canal: "email",
    responsavel: "Sofia Marques",
    proximaAcao: "Reavaliação de bioimpedância",
    ultimaInteracao: "29/08/2026",
    agendamento: null,
    timeline: [{ data: "20/08/2026", titulo: "Consulta de retorno", detalhe: "Evolução dentro do previsto" }],
  },
  {
    id: "c9",
    nome: "Inês Loureiro",
    telefone: "+351 968 441 025",
    email: "ines.loureiro@exemplo.pt",
    etapa: "reativacao",
    tags: ["DEMO", "Inativo 90 dias"],
    origem: "Instagram",
    canal: "instagram",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Campanha de reativação",
    ultimaInteracao: "12/06/2026",
    agendamento: null,
    timeline: [{ data: "12/06/2026", titulo: "Última interação", detalhe: "Sem resposta desde então" }],
  },
  {
    id: "c10",
    nome: "André Salvador",
    telefone: "+351 927 665 190",
    email: "andre.salvador@exemplo.pt",
    etapa: "consulta_realizada",
    tags: ["DEMO"],
    origem: "Indicação",
    canal: "whatsapp",
    responsavel: "Ana Ribeiro",
    proximaAcao: "Enviar orçamento",
    ultimaInteracao: "04/09/2026",
    agendamento: null,
    timeline: [{ data: "04/09/2026", titulo: "Consulta realizada", detalhe: "Relatório corporal entregue" }],
  },
];

export type Intencao = "informacao" | "preco" | "agendamento" | "objecao" | "pos_procedimento" | "urgencia";

export const intencaoLabel: Record<Intencao, string> = {
  informacao: "Informação",
  preco: "Preço",
  agendamento: "Agendamento",
  objecao: "Objeção",
  pos_procedimento: "Pós-procedimento",
  urgencia: "Urgência",
};

export type Conversation = {
  id: string;
  contactId: string;
  canal: Canal;
  ultimaMensagem: string;
  quando: string;
  naoLidas: number;
  intencao: Intencao;
  sentimento: "positivo" | "neutro" | "negativo";
  prioridade: "alta" | "media" | "baixa";
  resumo: string;
  mensagens: { autor: "cliente" | "clinica"; texto: string; hora: string }[];
  sugestoes: { tom: "Objetiva" | "Acolhedora" | "Premium"; texto: string }[];
};

export const conversations: Conversation[] = [
  {
    id: "cv1",
    contactId: "c1",
    canal: "instagram",
    ultimaMensagem: "Bom dia! Queria saber como funciona o acompanhamento.",
    quando: "há 8 min",
    naoLidas: 2,
    intencao: "informacao",
    sentimento: "positivo",
    prioridade: "alta",
    resumo:
      "Lead novo vindo de campanha no Instagram. Demonstra interesse em acompanhamento de emagrecimento e pergunta como funciona a primeira avaliação. Ainda não recebeu resposta da equipa.",
    mensagens: [
      { autor: "cliente", texto: "Bom dia! Vi o vosso conteúdo sobre composição corporal.", hora: "09:12" },
      { autor: "cliente", texto: "Queria saber como funciona o acompanhamento.", hora: "09:14" },
    ],
    sugestoes: [
      {
        tom: "Objetiva",
        texto:
          "Bom dia, Mariana. O acompanhamento começa com uma avaliação de composição corporal por bioimpedância e um relatório corporal completo. Tenho vagas esta semana — prefere manhã ou tarde?",
      },
      {
        tom: "Acolhedora",
        texto:
          "Bom dia, Mariana, que bom tê-la por aqui. O primeiro passo é uma avaliação tranquila da sua composição corporal, para percebermos o seu ponto de partida com clareza. Quer que reserve um horário para si esta semana?",
      },
      {
        tom: "Premium",
        texto:
          "Bom dia, Mariana. O acompanhamento do Dr. João Falcão inicia-se com uma avaliação clínica detalhada e um relatório corporal individual, base da sua estratégia metabólica. Posso reservar-lhe um horário exclusivo esta semana?",
      },
    ],
  },
  {
    id: "cv2",
    contactId: "c5",
    canal: "email",
    ultimaMensagem: "Recebi o orçamento, mas achei o valor acima do previsto.",
    quando: "há 2 h",
    naoLidas: 1,
    intencao: "objecao",
    sentimento: "neutro",
    prioridade: "alta",
    resumo:
      "Paciente recebeu o orçamento do protocolo de 3 meses e levantou objeção de valor. Não recusou; pede alternativas de condições.",
    mensagens: [
      { autor: "clinica", texto: "Enviámos o orçamento do protocolo de acompanhamento.", hora: "11:02" },
      { autor: "cliente", texto: "Recebi o orçamento, mas achei o valor acima do previsto.", hora: "13:40" },
    ],
    sugestoes: [
      {
        tom: "Objetiva",
        texto:
          "Helena, obrigado pelo retorno. O protocolo pode ser organizado em fases, com condições de pagamento faseadas. Quer que lhe envie essa alternativa hoje?",
      },
      {
        tom: "Acolhedora",
        texto:
          "Helena, agradeço a sinceridade. Faz todo o sentido pensar no investimento com calma. Podemos ajustar o formato do acompanhamento ao seu momento — quer que veja consigo as opções?",
      },
      {
        tom: "Premium",
        texto:
          "Helena, obrigado pela confiança em partilhar. O acompanhamento é desenhado para resultado sustentado e pode ser estruturado por fases, mantendo o mesmo padrão clínico. Posso apresentar-lhe as condições disponíveis?",
      },
    ],
  },
  {
    id: "cv3",
    contactId: "c3",
    canal: "whatsapp",
    ultimaMensagem: "Consigo remarcar para a próxima semana?",
    quando: "há 5 h",
    naoLidas: 0,
    intencao: "agendamento",
    sentimento: "neutro",
    prioridade: "media",
    resumo: "Paciente com consulta marcada para 08/09 pede remarcação para a semana seguinte.",
    mensagens: [{ autor: "cliente", texto: "Consigo remarcar para a próxima semana?", hora: "10:20" }],
    sugestoes: [
      {
        tom: "Objetiva",
        texto: "Claro, Beatriz. Tenho 15/09 às 10:30 ou 16/09 às 14:00. Qual prefere?",
      },
      {
        tom: "Acolhedora",
        texto: "Sem problema nenhum, Beatriz. Tenho 15/09 às 10:30 ou 16/09 às 14:00 — qual lhe fica melhor?",
      },
      {
        tom: "Premium",
        texto:
          "Com certeza, Beatriz. Reservo-lhe 15/09 às 10:30 ou 16/09 às 14:00, mantendo o seu horário exclusivo. Qual prefere que confirme?",
      },
    ],
  },
  {
    id: "cv4",
    contactId: "c7",
    canal: "whatsapp",
    ultimaMensagem: "Está tudo bem, obrigada pelo acompanhamento!",
    quando: "ontem",
    naoLidas: 0,
    intencao: "pos_procedimento",
    sentimento: "positivo",
    prioridade: "baixa",
    resumo: "Paciente em pós-procedimento reporta boa evolução e agradece o acompanhamento.",
    mensagens: [{ autor: "cliente", texto: "Está tudo bem, obrigada pelo acompanhamento!", hora: "18:05" }],
    sugestoes: [
      { tom: "Objetiva", texto: "Ótimo saber, Carla. Volto a contactá-la no D+5 para acompanhar a evolução." },
      {
        tom: "Acolhedora",
        texto: "Que bom ler isso, Carla. Ficamos por perto — volto a falar consigo dentro de poucos dias.",
      },
      {
        tom: "Premium",
        texto:
          "Fico muito satisfeito, Carla. O acompanhamento continua: entrarei em contacto no D+5 para registar a sua evolução corporal.",
      },
    ],
  },
];

export type AutomationStatus = "rascunho" | "ativa" | "pausada";

export type CampoCondicao =
  | "etapa"
  | "tag"
  | "canal"
  | "responsavel"
  | "respondeu"
  | "status_agendamento";

export type OperadorCondicao = "igual" | "diferente" | "contem" | "nao_contem";

export type TipoAcao =
  | "enviar_whatsapp"
  | "enviar_email"
  | "enviar_sms"
  | "adicionar_tag"
  | "remover_tag"
  | "mover_etapa"
  | "atribuir_responsavel"
  | "criar_tarefa"
  | "chamar_webhook"
  | "pedir_sugestao_ia";

export type AutomationStep =
  | {
      tipo: "condicao";
      id: string;
      campo: CampoCondicao;
      operador: OperadorCondicao;
      valor: string;
      ramoSim?: AutomationStep[];
      ramoNao?: AutomationStep[];
    }
  | { tipo: "acao"; id: string; acao: TipoAcao; parametros: Record<string, string> }
  | { tipo: "espera"; id: string; duracao: number; unidade: "minutos" | "horas" | "dias" }
  | { tipo: "texto"; id: string; texto: string };

export type Automation = {
  id: string;
  nome: string;
  descricao?: string;
  status: AutomationStatus;
  versao: number;
  gatilho: string;
  passos: AutomationStep[];
  ultimaExecucao: string;
  taxaSucesso: number;
  erros: number;
};

export const condicaoCampoLabel: Record<CampoCondicao, string> = {
  etapa: "Etapa",
  tag: "Tag",
  canal: "Canal",
  responsavel: "Responsável",
  respondeu: "Respondeu",
  status_agendamento: "Status de agendamento",
};

export const operadorLabel: Record<OperadorCondicao, string> = {
  igual: "é",
  diferente: "não é",
  contem: "contém",
  nao_contem: "não contém",
};

export const acaoLabel: Record<TipoAcao, string> = {
  enviar_whatsapp: "Enviar WhatsApp",
  enviar_email: "Enviar e-mail",
  enviar_sms: "Enviar SMS",
  adicionar_tag: "Adicionar tag",
  remover_tag: "Remover tag",
  mover_etapa: "Mover etapa",
  atribuir_responsavel: "Atribuir responsável",
  criar_tarefa: "Criar tarefa",
  chamar_webhook: "Chamar webhook",
  pedir_sugestao_ia: "Pedir sugestão à IA",
};

export function labelPasso(p: AutomationStep): string {
  switch (p.tipo) {
    case "condicao":
      return `Se ${condicaoCampoLabel[p.campo]} ${operadorLabel[p.operador]} "${p.valor}"`;
    case "acao":
      return acaoLabel[p.acao];
    case "espera":
      return `Aguardar ${p.duracao} ${p.unidade}`;
    case "texto":
      return p.texto;
  }
}

export function resumoPasso(p: AutomationStep): string | null {
  switch (p.tipo) {
    case "acao": {
      const params = Object.entries(p.parametros)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      return params || null;
    }
    case "condicao":
      return p.ramoSim?.length || p.ramoNao?.length ? "Com ramificação" : null;
    default:
      return null;
  }
}

function ac(id: string, acao: TipoAcao, parametros: Record<string, string> = {}): AutomationStep {
  return { tipo: "acao", id, acao, parametros };
}

function cond(id: string, campo: CampoCondicao, operador: OperadorCondicao, valor: string): AutomationStep {
  return { tipo: "condicao", id, campo, operador, valor };
}

function espera(id: string, duracao: number, unidade: "minutos" | "horas" | "dias"): AutomationStep {
  return { tipo: "espera", id, duracao, unidade };
}

export const automations: Automation[] = [
  {
    id: "a1",
    nome: "Novo lead — resposta imediata",
    descricao: "Responde automaticamente a novos leads que entram pelo WhatsApp.",
    status: "ativa",
    versao: 3,
    gatilho: "Contacto criado",
    passos: [
      cond("a1-c1", "canal", "igual", "whatsapp"),
      ac("a1-a1", "enviar_whatsapp", { modeloId: "t1" }),
      ac("a1-a2", "adicionar_tag", { tag: "Lead respondido" }),
      ac("a1-a3", "atribuir_responsavel", { responsavel: "Ana Ribeiro" }),
    ],
    ultimaExecucao: "04/09/2026 21:02",
    taxaSucesso: 98,
    erros: 0,
  },
  {
    id: "a2",
    nome: "4 dias sem resposta — reativação",
    descricao: "Reativa leads que não responderam em 4 dias.",
    status: "ativa",
    versao: 2,
    gatilho: "Tempo sem resposta (4 dias)",
    passos: [
      cond("a2-c1", "respondeu", "igual", "nao"),
      ac("a2-a1", "enviar_whatsapp", { modeloId: "t5" }),
      ac("a2-a2", "mover_etapa", { etapa: "reativacao" }),
    ],
    ultimaExecucao: "04/09/2026 08:30",
    taxaSucesso: 91,
    erros: 2,
  },
  {
    id: "a3",
    nome: "Consulta agendada — boas-vindas",
    descricao: "Confirma dados e prepara o paciente após agendamento.",
    status: "ativa",
    versao: 1,
    gatilho: "Consulta agendada",
    passos: [
      ac("a3-a1", "enviar_whatsapp", { modeloId: "t2" }),
      ac("a3-a2", "criar_tarefa", { titulo: "Preparar recepção D-1" }),
    ],
    ultimaExecucao: "03/09/2026 16:11",
    taxaSucesso: 100,
    erros: 0,
  },
  {
    id: "a4",
    nome: "Consulta D-1 — confirmação e preparo",
    descricao: "Lembrete de confirmação um dia antes da consulta.",
    status: "ativa",
    versao: 4,
    gatilho: "Data/hora relativa (D-1 da consulta)",
    passos: [
      ac("a4-a1", "enviar_whatsapp", { modeloId: "t2" }),
      espera("a4-w1", 4, "horas"),
      cond("a4-c1", "respondeu", "igual", "nao"),
      ac("a4-a2", "enviar_sms", { modeloId: "t2" }),
    ],
    ultimaExecucao: "04/09/2026 18:00",
    taxaSucesso: 87,
    erros: 3,
  },
  {
    id: "a5",
    nome: "Consulta confirmada — agradecimento",
    descricao: "Agradece a confirmação e organiza a receção.",
    status: "pausada",
    versao: 1,
    gatilho: "Consulta confirmada",
    passos: [
      ac("a5-a1", "enviar_whatsapp", { modeloId: "t1" }),
      ac("a5-a2", "adicionar_tag", { tag: "Confirmado" }),
    ],
    ultimaExecucao: "28/08/2026 10:44",
    taxaSucesso: 96,
    erros: 0,
  },
  {
    id: "a6",
    nome: "Pós-consulta — orçamento e follow-up",
    descricao: "Acompanha orçamentos enviados sem resposta.",
    status: "ativa",
    versao: 2,
    gatilho: "Oportunidade mudou de etapa → Orçamento Enviado",
    passos: [
      espera("a6-w1", 2, "dias"),
      cond("a6-c1", "respondeu", "igual", "nao"),
      ac("a6-a1", "pedir_sugestao_ia", {}),
      ac("a6-a2", "criar_tarefa", { titulo: "Follow-up do orçamento" }),
    ],
    ultimaExecucao: "04/09/2026 09:15",
    taxaSucesso: 93,
    erros: 1,
  },
  {
    id: "a7",
    nome: "Procedimento agendado — acolhimento",
    descricao: "Envia orientações pré-procedimento.",
    status: "rascunho",
    versao: 1,
    gatilho: "Oportunidade mudou de etapa → Procedimento Agendado",
    passos: [
      ac("a7-a1", "enviar_whatsapp", { modeloId: "t1" }),
      ac("a7-a2", "enviar_email", { modeloId: "t3" }),
    ],
    ultimaExecucao: "—",
    taxaSucesso: 0,
    erros: 0,
  },
  {
    id: "a8",
    nome: "Pós-procedimento D+0, D+2, D+5 e D+7",
    descricao: "Acompanhamento pós-procedimento em vários momentos.",
    status: "ativa",
    versao: 5,
    gatilho: "Oportunidade mudou de etapa → Pós-Procedimento",
    passos: [
      ac("a8-a1", "enviar_whatsapp", { modeloId: "t4" }),
      espera("a8-w1", 2, "dias"),
      ac("a8-a2", "enviar_whatsapp", { modeloId: "t4" }),
      espera("a8-w2", 3, "dias"),
      ac("a8-a3", "enviar_whatsapp", { modeloId: "t4" }),
      espera("a8-w3", 2, "dias"),
      ac("a8-a4", "criar_tarefa", { titulo: "Reavaliação de acompanhamento" }),
    ],
    ultimaExecucao: "04/09/2026 07:00",
    taxaSucesso: 95,
    erros: 1,
  },
];

export type AutomationRun = {
  id: string;
  automacao: string;
  cliente: string;
  quando: string;
  estado: "sucesso" | "erro" | "simulado";
  detalhe: string;
};

export const automationRuns: AutomationRun[] = [
  {
    id: "r1",
    automacao: "Novo lead — resposta imediata",
    cliente: "Mariana Coelho",
    quando: "04/09/2026 21:02",
    estado: "simulado",
    detalhe: "Modo demonstração: mensagem não enviada ao GHL.",
  },
  {
    id: "r2",
    automacao: "Consulta D-1 — confirmação e preparo",
    cliente: "Tiago Ferreira",
    quando: "04/09/2026 18:00",
    estado: "simulado",
    detalhe: "Simulação de confirmação D-1.",
  },
  {
    id: "r3",
    automacao: "4 dias sem resposta — reativação",
    cliente: "Inês Loureiro",
    quando: "04/09/2026 08:30",
    estado: "erro",
    detalhe: "Sem ligação ao GoHighLevel: credenciais não configuradas.",
  },
  {
    id: "r4",
    automacao: "Pós-procedimento D+0, D+2, D+5 e D+7",
    cliente: "Carla Meireles",
    quando: "04/09/2026 07:00",
    estado: "simulado",
    detalhe: "Mensagem D+2 preparada.",
  },
];

export type MessageTemplate = {
  id: string;
  nome: string;
  etapa: StageId;
  canal: Canal;
  idioma: "PT-BR" | "PT-PT" | "FR" | "ES" | "EN";
  corpo: string;
};

export const messageTemplates: MessageTemplate[] = [
  {
    id: "t1",
    nome: "Boas-vindas ao novo lead",
    etapa: "novo_lead",
    canal: "whatsapp",
    idioma: "PT-PT",
    corpo:
      "Olá {{contact.first_name}}, é a {{user.first_name}} da clínica do Dr. João Falcão. Recebemos o seu contacto e ficamos ao dispor para explicar como funciona a avaliação de composição corporal. Prefere manhã ou tarde?",
  },
  {
    id: "t2",
    nome: "Confirmação D-1",
    etapa: "consulta_agendada",
    canal: "whatsapp",
    idioma: "PT-PT",
    corpo:
      "Olá {{contact.first_name}}, a sua consulta está marcada para {{appointment.date}} às {{appointment.time}}. Pode confirmar a sua presença, por favor?",
  },
  {
    id: "t3",
    nome: "Follow-up de orçamento",
    etapa: "orcamento_enviado",
    canal: "email",
    idioma: "PT-BR",
    corpo:
      "Olá {{contact.first_name}}, tudo bem? Passando para saber se ficou alguma dúvida sobre o plano enviado. Estou à disposição para explicar cada etapa com calma.",
  },
  {
    id: "t4",
    nome: "Acompanhamento pós-procedimento D+2",
    etapa: "pos_procedimento",
    canal: "whatsapp",
    idioma: "PT-PT",
    corpo:
      "Olá {{contact.first_name}}, como se tem sentido nestes dois dias? A equipa do Dr. João Falcão está a acompanhar de perto a sua evolução.",
  },
  {
    id: "t5",
    nome: "Reativação 90 dias",
    etapa: "reativacao",
    canal: "whatsapp",
    idioma: "PT-PT",
    corpo:
      "Olá {{contact.first_name}}, faz algum tempo que não falamos. Se quiser retomar o seu acompanhamento, tenho horários disponíveis com {{user.first_name}}.",
  },
  {
    id: "t6",
    nome: "Welcome message",
    etapa: "novo_lead",
    canal: "email",
    idioma: "EN",
    corpo:
      "Hello {{contact.first_name}}, thank you for reaching out to Dr. João Falcão's clinic. We would be glad to walk you through the body composition assessment. Would morning or afternoon suit you best?",
  },
];

export const kpis = {
  novosLeads: 42,
  consultasAgendadas: 18,
  taxaConfirmacao: 82,
  orcamentosPendentes: 7,
  procedimentosAgendados: 5,
  pacientesFollowUp: 23,
  automacoesComErro: 2,
};

export const funil = [
  { etapa: "Novo Lead", valor: 42 },
  { etapa: "Em Atendimento", valor: 31 },
  { etapa: "Consulta Agendada", valor: 18 },
  { etapa: "Consulta Realizada", valor: 14 },
  { etapa: "Orçamento", valor: 9 },
  { etapa: "Procedimento", valor: 5 },
];

export const acoesPrioritarias = [
  { tipo: "Lead sem resposta", cliente: "Mariana Coelho", detalhe: "Aguarda há 8 minutos", urgencia: "alta" },
  { tipo: "Consulta D-1", cliente: "Tiago Ferreira", detalhe: "Consulta amanhã às 09:00", urgencia: "alta" },
  { tipo: "Orçamento sem follow-up", cliente: "Helena Prazeres", detalhe: "Enviado há 2 dias", urgencia: "media" },
  {
    tipo: "Falha de sincronização",
    cliente: "Integração GoHighLevel",
    detalhe: "Credenciais por configurar",
    urgencia: "alta",
  },
];

export const equipa = [
  { nome: "Dr. João Falcão", email: "joao.falcao@exemplo.pt", papel: "Administrador" },
  { nome: "Ana Ribeiro", email: "ana.ribeiro@exemplo.pt", papel: "Gestor" },
  { nome: "Sofia Marques", email: "sofia.marques@exemplo.pt", papel: "Comercial" },
  { nome: "Rui Tavares", email: "rui.tavares@exemplo.pt", papel: "Visualizador" },
];

export function mascararTelefone(telefone: string): string {
  const visivel = telefone.slice(-4);
  const prefixo = telefone.slice(0, 4);
  return `${prefixo} ••• ••• ${visivel}`;
}

export function contactById(id: string): Contact | undefined {
  return contacts.find((c) => c.id === id);
}

export function stageName(id: StageId): string {
  return journeyStages.find((s) => s.id === id)?.nome ?? id;
}
