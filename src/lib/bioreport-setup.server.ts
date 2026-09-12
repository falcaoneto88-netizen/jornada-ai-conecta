import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const configSchema = z.object({
  secret: z.string().regex(/^[a-f0-9]{64}$/),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  organizationId: z.uuid(),
  locationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
type Config = z.infer<typeof configSchema>;

/** Chamado no servidor autenticado; nunca devolve credenciais ou erros do banco. */
export async function configureBioreport(
  client: SupabaseClient,
  confirm: boolean,
  readConfig: () => unknown = (): Config => ({
    secret: process.env["BIOREPORT_JORNADA_SIGNING_SECRET"] ?? "",
    keyId: process.env["BIOREPORT_JORNADA_KEY_ID"] ?? "",
    organizationId: process.env["JORNADA_AI_ORGANIZATION_ID"] ?? "",
    locationId: process.env["GHL_LOCATION_ID"] ?? "",
  }),
): Promise<{ ok: boolean; message: string }> {
  if (confirm !== true) return { ok: false, message: "Confirme o cadastro da integração." };
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return { ok: false, message: "Sessão expirada. Inicie sessão novamente." };
    const role = await client.rpc("tem_papel", { _papeis: ["administrador"] });
    if (role.error || role.data !== true)
      return { ok: false, message: "Acesso restrito a administradores." };
    const config = configSchema.safeParse(readConfig());
    if (!config.success)
      return {
        ok: false,
        message: "A configuração privada está incompleta no servidor Jornada AI.",
      };
    const c = config.data;
    const result = await client.rpc("configure_bioreport_integration", {
      _organization_id: c.organizationId,
      _key_id: c.keyId,
      _secret: c.secret,
      _location_id: c.locationId,
      _confirm: true,
    });
    if (result.error || result.data?.configured !== true)
      return {
        ok: false,
        message:
          "Cadastro recusado. Confira a organização, a configuração privada e se esta chave já foi cadastrada ou revogada.",
      };
    return {
      ok: true,
      message:
        "Chave cadastrada e recebimento habilitado. Nenhum evento, mensagem ou workflow foi executado.",
    };
  } catch {
    return {
      ok: false,
      message: "Não foi possível configurar a integração. Confira a sessão e tente novamente.",
    };
  }
}
