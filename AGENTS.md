<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Inbox send (/caixa-de-entrada) reuses the commercial-agent manual ledger via `inboxSend` (requestId = idempotency key; prepare+send in one human click). Why: durable dedup/locks already exist in SQL; no parallel send path.
- Draft correction uses `correcao-texto.core.ts` (linguistic-only prompt + invariant check), never `melhorarTexto`. Why: the latter rewrites commercially.
