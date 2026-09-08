/** Adaptador que expõe a base de dados de teste com a interface do cliente service-role. */
import type { ClienteRpc } from "@/lib/ghl-webhook.server";
import type { Db } from "./pg";

const CASTS: Record<string, string> = {
  _org: "uuid",
  _inbox_id: "uuid",
  _fence: "integer",
  _lock_timeout_seconds: "integer",
  _payload: "jsonb",
  _tags: "text[]",
  _content_fallback: "boolean",
  _last_interaction: "timestamptz",
};

function literal(nome: string, valor: unknown): string {
  const cast = CASTS[nome] ?? "text";
  if (valor === null || valor === undefined) return `null::${cast}`;
  if (cast === "integer") return `${Number(valor)}::integer`;
  if (cast === "boolean") return `${valor ? "true" : "false"}::boolean`;
  if (cast === "jsonb") return `'${JSON.stringify(valor).replace(/'/g, "''")}'::jsonb`;
  if (cast === "text[]") {
    const itens = (valor as string[]).map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
    return `'{${itens.replace(/'/g, "''")}}'::text[]`;
  }
  return `'${String(valor).replace(/'/g, "''")}'::${cast}`;
}

export function criarClienteRpc(db: Db): ClienteRpc {
  return {
    rpc: async (fn, args) => {
      const argsSql = Object.entries(args)
        .map(([k, v]) => `${k} => ${literal(k, v)}`)
        .join(", ");
      try {
        const linhas = await db.query(`select public.${fn}(${argsSql})`);
        const bruto = linhas[0]?.["c0"];
        if (bruto === null || bruto === undefined) return { data: null, error: null };
        const s = String(bruto);
        if (s === "t" || s === "f") return { data: s === "t", error: null };
        try {
          return { data: JSON.parse(s) as unknown, error: null };
        } catch {
          return { data: s, error: null };
        }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : "erro" } };
      }
    },
    from: (tabela) => ({
      select: (colunas) => ({
        eq: (coluna, valor) => ({
          maybeSingle: async () => {
            const linhas = await db.query(
              `select ${colunas} from public.${tabela} where ${coluna} = '${valor.replace(/'/g, "''")}' limit 1`,
            );
            const l = linhas[0];
            if (!l) return { data: null, error: null };
            const nomes = colunas.split(",").map((c) => c.trim());
            const obj: Record<string, unknown> = {};
            nomes.forEach((n, i) => {
              obj[n] = l[`c${i}`];
            });
            return { data: obj, error: null };
          },
        }),
      }),
    }),
  };
}
