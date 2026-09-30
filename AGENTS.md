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

## n8n bridge
- `/api/public/n8n/bridge` is the only n8n→GHL path: strict op union, Bearer `N8N_JORNADA_BRIDGE_TOKEN`, server-resolved scope, durable reservation before one POST. Why: n8n must never hold the GHL token nor send free text.
- Its migration lives only in `sql/pending/0013_n8n_bridge_v1.sql` until manually applied. Why: activation is manual and production must not change implicitly.
