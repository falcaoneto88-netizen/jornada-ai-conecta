// Executar apenas pelo operador do banco, após revisar/aplicar a migração.
// Credenciais entram por ambiente; nunca são impressas, passadas por argumentos ou retornadas.
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const require = createRequire(
  join(process.env.BIOREPORT_TEST_RUNTIME || resolve("test/bioreport-runtime"), "package.json"),
);
const { Client } = require("pg");
let client;
try {
  if (!process.argv.includes("--apply"))
    throw new Error("Revise a configuração e execute com --apply para cadastrar a chave privada.");
  const secret = process.env.BIOREPORT_JORNADA_SIGNING_SECRET ?? "";
  const keyId = process.env.BIOREPORT_JORNADA_KEY_ID ?? "";
  const org = process.env.JORNADA_AI_ORGANIZATION_ID ?? "";
  const location = process.env.GHL_LOCATION_ID ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(secret) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(keyId) ||
    !/^[a-f0-9-]{36}$/.test(org) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(location)
  )
    throw new Error("Confira as quatro variáveis da integração no ambiente privado.");
  const url = new URL(process.env.JORNADA_DATABASE_URL ?? "");
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("Conexão PostgreSQL inválida.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  // Evita que parâmetros de conexão desativem a verificação TLS de produção.
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("ssl")) url.searchParams.delete(key);
  client = new Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query("begin");
  const binding = await client.query(
    "select 1 from public.ghl_location_bindings where organization_id=$1 and location_id=$2",
    [org, location],
  );
  if (binding.rowCount !== 1) throw new Error("A organização não está vinculada a esta location.");
  await client.query(
    "insert into bioreport_private.signing_keys(organization_id,key_id,secret) values($1,$2,$3) on conflict do nothing",
    [org, keyId, secret],
  );
  const current = await client.query(
    "select secret=$3 and enabled as matches from bioreport_private.signing_keys where organization_id=$1 and key_id=$2",
    [org, keyId, secret],
  );
  if (current.rows[0]?.matches !== true)
    throw new Error(
      "Esta identificação de chave já está ocupada ou revogada. Use uma identificação nova.",
    );
  await client.query("commit");
  console.log("Chave privada cadastrada. Nenhum evento clínico ou mensagem foi enviado.");
} catch (error) {
  if (client) await client.query("rollback").catch(() => undefined);
  // Não imprimir exceções do driver: podem conter URL de conexão ou parâmetros.
  console.error(
    error instanceof Error &&
      !("code" in error) &&
      /^(Revise|Confira|Conexão|A organização|Esta identificação)/.test(error.message)
      ? error.message
      : "Não foi possível configurar a integração. Confira a migração, conexão e permissões do operador.",
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
