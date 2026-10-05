# Evidências de validação — 05/10/2026

Ambiente exclusivamente local, provedores e contatos fictícios. Não houve publicação nem mensagens a pacientes.

| Verificação                                                                                                           | Resultado                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Regras, contratos HighLevel/OpenAI, fronteira HTTP e transações PostgreSQL do agente                                  | 63 testes aprovados em 4 arquivos                                            |
| Regressões de autorização, acesso, observação e webhook HighLevel                                                     | 38 testes aprovados                                                          |
| Todas as migrações do repositório, incluindo a nova, em PostgreSQL descartável + regressão da biblioteca de mensagens | 32 verificações aprovadas                                                    |
| TypeScript `tsc --noEmit`                                                                                             | Aprovado                                                                     |
| Build Vite de cliente e servidor                                                                                      | Aprovado; avisos de depreciação `inputValidator` e `vite-tsconfig-paths`     |
| ESLint nos arquivos implementados                                                                                     | Sem erros; aviso de Fast Refresh por constante exportada junto ao componente |
| Busca no bundle público por marcadores de credenciais, cliente administrativo e prompt privado                        | Nenhum marcador encontrado; não equivale a auditoria formal                  |

Os testes transacionais cobrem: nenhuma saída antes da aprovação; duas aprovações concorrentes geram no máximo uma tentativa; webhook repetido; mismatch de IDs; isolamento entre organizações; anônimo/usuário comum sem acesso direto às tabelas e RPC privilegiada; versão/hash adulterados; nova mensagem; DND; pausa em outro canal; recusa atual/anterior; timeout; crash; reconciliação de recibo; retomada bloqueada; falha de modelo sanitizada; tentativas esgotadas; configuração desligada.

A fronteira HTTP recusa segredo ou assinatura incorretos, corpo enorme e evento sem ID estável. Não usa segredo alternativo após falha de assinatura. Descarta texto/instruções extras do webhook e exige segredo próprio do worker.

## Demonstração pela interface

Navegador aberto pelo servidor `http://127.0.0.1:4191/demo/commercial-agent.html`. Conferidos visualmente:

- Recebimento fictício persistido; histórico exibido; resposta de consulta a 50 €; caixa de saída vazia antes da aprovação.
- Confirmação humana com destinatário e texto; uma mensagem na conversa fictícia `v-test`, contato `c-test`; botão de enviar fica desabilitado.
- Repetição do webhook retorna `duplicate`, sem nova mensagem.
- Conflito de preço 30 €/50 € sinalizado, com aprovação bloqueada.
- Pedido de Danilo pausa o contato; retomada autenticada invalida o rascunho anterior.
- Timeout deixa envio `unknown`, mantém pausa e impede retomada sem reconciliação.
- Recusa mantém a caixa de saída vazia e desabilita envio/retomada.

O resultado anterior, em 04/10, não havia completado essa validação visual. Em 05/10 o servidor estava parado e o usuário abriu o arquivo HTML por `file://`. O servidor foi reiniciado, o endereço correto foi aberto e o fluxo acima foi repetido com sucesso. O HTML agora explica que é necessário iniciar o servidor, evitando página vazia quando aberto diretamente.

## Limites da evidência

A demonstração chama o serviço real com fixtures, não os provedores remotos. O contrato HTTP é exercitado em testes isolados. Permanecem pendentes: implantação no ambiente hospedado, segredos, autenticação e conectividade reais, mapeamento de webhook real, agendamento ativo, recibo real no canal de teste e revisão humana da qualidade PT/FR/EN. Não foram testados dispositivos físicos nem envio a pacientes.

O SQL do scheduler é um template revisável, inativo por padrão; não foi executado no banco remoto. O build local não comprova limites de duração/recursos do provedor. A extensão do funcionamento para produção depende dessas validações.
