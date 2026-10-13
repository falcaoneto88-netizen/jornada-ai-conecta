# Verificação somente leitura — pré-implantação "Meu dia" (13/10/2026)

## Evidências
- HEAD `62736be971573df7c01f1554ffc3e37e67e9c343`; working tree limpo (0 alterações).
- Configuração do servidor (apenas presença): chave de cifra presente e estruturalmente válida (32 bytes em base64); URL do backend, chave pública, chave de serviço, token GHL e location GHL presentes.
- Location configurada coincide com `ok2UHC2QMZsd8UHsAgEa`.
- Base de dados (SELECT): vínculo organização `f07ab3be-…f0` ↔ location existe (1 registo); organização `is_demo=false`.
- GHL read-only (Version 2021-07-28): `GET locations/{id}` 200, ID coincide; `GET opportunities/pipelines` 200, 6 pipelines (só contagem).
- Observação: a primeira tentativa sem User-Agent recebeu 403 do WAF; com User-Agent identificado, 200. Sem bypass.

## Não feito
Nenhuma edição de código, banco, configuração, flags, workflows; sem publicação nem envio. Nenhum dado de pacientes/contactos/mensagens lido ou listado.

## Próximo passo
Aguardar o pacote exato de implantação de "Meu dia", contexto administrativo e rascunhos privados; ao recebê-lo, conferir hashes before/after e aplicar byte a byte.
