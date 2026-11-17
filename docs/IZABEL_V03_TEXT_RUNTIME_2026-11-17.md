# Izabel V03 — núcleo textual supervisionado

Data: 17/11/2026. Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## Causa comprovada

Na revisão `021f65b74cf97a8055b27ddc80a768ff46b08291`, dois geradores usavam documentos V02: `src/lib/izabel-reply.server.ts` (Meu Chat) e `src/lib/commercial-agent/providers.server.ts` (fila supervisionada). O primeiro proibia expressamente importar o pacote novo como política ativa. Os rótulos V02 refletiam essa implementação; não era suficiente trocar o texto da interface.

O pacote `izabel_codex_v1` recebido em 12/11 contém o treinamento de capa V03 e decisões do responsável, mas seu motor completo permaneceu num incremento local anterior. A divergência interna V04 do PDF está documentada na origem; não significa uma versão V04 operacional.

## Correção deste incremento

- Os dois geradores passam a consultar a mesma biblioteca textual privada V03. As regras de redação e o contrato de saída próprios de cada gerador permanecem.
- Dos 78 registros, 58 são candidatos editoriais comerciais (46 `approved_owner`, 12 `draft_supervised`). Apenas **30** entram neste incremento: sem condições pendentes, ou com `card_unavailable_or_text_requested`, satisfeita pelo gerador exclusivamente textual. Os outros **48** permanecem excluídos. A exclusão inclui textos condicionados mesmo quando seu status editorial é aprovado, além de CONVITE_DATAS: o texto literal promete informar datas, capacidade indisponível neste incremento.
- IDs, texto original, páginas físicas, fonte, modo, condições e status são preservados no artefato privado. Novas redações e traduções continuam exigindo revisão humana.
- Escopo vem da sessão autenticada ou do vínculo servidor→organização→location já existente. O carregador compara esse escopo ao titular da biblioteca; não escolhe a organização a partir do navegador, telefone ou nome.
- O hash da política inclui regras, versão e hash fixado da biblioteca. Sugestões V02 existentes na fila supervisionada conservam sua origem e passam a ser consideradas antigas; a aprovação exige nova geração. Não há alteração retroativa de respostas enviadas nem reprocessamento de conversas. Rascunhos livres já copiados para o editor do Meu Chat não possuem esse vínculo de política: é preciso preparar uma nova sugestão; não há invalidação automática desses textos manuais.
- Falta de configuração, bucket público, arquivo alterado ou escopo divergente bloqueiam a geração, com erro sanitizado. Não existe retorno silencioso para V02.
- A evidência de agenda existente continua sendo redigida pelo servidor após conferir o compromisso exato no GHL. A biblioteca não ganha capacidade de criar, confirmar ou modificar consultas.

Arquivos centrais: `src/lib/izabel/knowledge-v03.server.ts`, `src/lib/izabel-reply.server.ts`, `src/lib/commercial-agent/providers.server.ts`, `runtime.server.ts`, `http.server.ts` e `observer.server.ts`.

## Biblioteca privada e implantação

O repositório GitHub é público (metadados consultados em 17/11). A biblioteca não deve ser incluída em `src`, `public`, commits, anexos públicos, logs, chats ou bundles. O artefato local está em `private/izabel-v03/library.json`, ignorado pelo Git, permissão 0600. Ele contém somente os 30 registros selecionados, sem fotos nem PDF.

- Tamanho: 21.503 bytes.
- SHA-256: `3a376149836f2af2d67790d89898ee6218be1ae213f714c28e700f76d630a6bd`.
- Configuração nova: `IZABEL_KNOWLEDGE_BUCKET`, somente no servidor, apontando para um bucket **privado**.
- Objeto: `organizations/<organizationId>/locations/<locationId>/izabel/V03/text-only-v1.json`.
- Vínculo autorizado: organização `f07ab3be-7419-4779-a901-ef71c5fc27f0`, location `ok2UHC2QMZsd8UHsAgEa`; esses valores são conferência de titularidade, não substituem autenticação.
- O acesso usa o cliente administrativo de Storage já existente, somente depois de conferir o escopo. Não copiar credenciais entre aplicações, não criar leitura pública, não enfraquecer RLS.

**Ordem necessária:** provisionar o arquivo privado no projeto original, definir o nome do bucket, conferir privacidade/hash/escopo com o carregador, aplicar a revisão de código e só então publicar. Não publicar este incremento com biblioteca ausente: novas sugestões ficariam indisponíveis por segurança. A autorização para atualizar o projeto já existe; o acesso técnico e a validação do armazenamento são dependências distintas.

## O que continua pendente

Este incremento **não é a implantação completa do motor de jornada V03**. Persistência de fases, recibos de materiais, transferência real, condições comerciais de €1.600, textos clínicos condicionados, mídias e interpretação semântica completa dependem de evidências e integração adicionais. O contexto de consulta de €50 é uma informação editorial fornecida em 12/11, não uma reconferência atual da oferta. Não é inferida relação de crédito, abatimento ou cobrança adicional.

As guardas de saída são verificações adicionais, não prova de qualidade clínica ou de compreensão perfeita por um LLM. Não houve validação clínica independente. Os testes locais com respostas simuladas não comprovam qualidade de respostas geradas pelo modelo real.

Permanecem: aprovação humana, pausa, DND, isolamento, validação de identidade, janelas do canal e prevenção de duplicação existentes. Não foram criadas migrações nem alterados n8n, GHL, contatos, oportunidades ou workflows.

## Verificação publicada e acesso

Leitura pública de `/api/version` em 17/11/2026 às 14:09:44 UTC: `jornada-n8n-production-20261116.3`, `release: null`. Esse endpoint não informa a política V02/V03 nem permite identificar o SHA publicado; a causa V02 foi comprovada no código remoto, não por uma resposta nova de paciente.

Esta revisão prepara o identificador `jornada-izabel-v03-20261117.1` e metadados públicos `izabel.knowledgeVersion=V03`, escopo textual supervisionado e dependência de biblioteca privada. O identificador é evidência do código publicado, não comprovação de configuração ou teste ponta a ponta.

Nesta sessão, `Lovable.get_project` e `get_database_status` retornaram `-32603: Internal error`; a aba Chrome compartilhada não pôde ser controlada (`timeoutMs`). O conector GitHub informou `pull: true`, `push: false`. O usuário informou que vai reconectar o Lovable. Nenhuma tentativa de publicação foi feita com configuração incompleta.

## Aceite operacional após restabelecer acesso

1. Conferir o SHA no editor original, preservando mudanças posteriores ao commit-base.
2. Validar biblioteca privada, tenant/location e hash; testes negativos sem dados reais.
3. Publicar a revisão testada e conferir `/api/version`.
4. Na sessão autenticada, preparar um rascunho novo no Meu Chat sem enviar: a fonte deve identificar V03 somente após leitura bem-sucedida da biblioteca.
5. Conferir geração no outro provider e recusa de aprovação de sugestão antiga. Não reativar eventos ou responder a contatos para provocar o teste.
6. Revisão da equipe para respostas sintéticas PT/FR/EN, preço de consulta, dúvida sem fonte, adiamento, opt-out e clínica individual. Sem mensagens reais nesta validação.

Rollback: reverter o commit de código por novo commit, sem reescrever histórico. Não alterar conversas ou rascunhos históricos. Manter o objeto privado para auditoria; sua presença não ativa envio. Nunca remover a privacidade ou ignorar integridade como solução de falha.

## Testes

Resultados finais registrados no complemento de `docs/MCP_CODEX_HANDOFF.md`. Separar testes do pacote documental, testes unitários/contrato, build, banco isolado e operação publicada; não somar subconjuntos sobrepostos.
