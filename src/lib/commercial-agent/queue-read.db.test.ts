import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { POLICY_HASH } from "./providers.server";

// Optional isolated PostgreSQL/WASM harness. No production URL, credentials or network.
// JORNADA_QUEUE_PGLITE_MODULE points to a separately installed temporary pglite/dist/index.js.
const modulePath = process.env["JORNADA_QUEUE_PGLITE_MODULE"];
interface EmbeddedDb {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}
const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444";
type SqlProjection = {
  asOf: string;
  counts: { review: number; team: number; uncertain: number; history: number };
  items: Array<{ id: string; contact_id: string; contact_name: string | null; category: string }>;
  errors: Array<{ state: string; error_code: string }>;
  failedEventCount: number;
  ignoredEventCount: number;
  total: number;
};
describe.skipIf(!modulePath)("projeção SQL isolada da fila (PostgreSQL/WASM)", () => {
  let db: EmbeddedDb;
  const startedAt = Date.now();
  async function seedDraft(
    contact: string,
    options: {
      state?: string;
      paused?: boolean;
      flags?: string[];
      expired?: boolean;
      policy?: string;
      contactVersion?: number;
      empty?: boolean;
      organization?: string;
      createdAt?: string;
      name?: string;
    } = {},
  ) {
    const organization = options.organization ?? org;
    const location = organization === org ? "location-main" : "location-other";
    const eventId = randomUUID(),
      draftId = randomUUID();
    const created = options.createdAt ?? new Date(startedAt - 3600_000).toISOString();
    await db.query(
      "insert into contacts(organization_id,ghl_contact_id,full_name,is_demo) values($1,$2,$3,false) on conflict do nothing",
      [organization, contact, options.name ?? contact],
    );
    await db.query(
      "insert into commercial_agent_sessions(organization_id,contact_id,version,paused) values($1,$2,1,$3) on conflict do nothing",
      [organization, contact, options.paused ?? false],
    );
    await db.query(
      "insert into commercial_agent_inbox(id,organization_id,event,contact_id,message_id,event_type,contact_version,state,created_at) values($1,$2,$3,$4,$5,'InboundMessage',1,'ready',$6)",
      [
        eventId,
        organization,
        JSON.stringify({
          type: "InboundMessage",
          locationId: location,
          contactId: contact,
          conversationId: `conversation-${contact}`,
          messageId: `message-${contact}`,
        }),
        contact,
        `message-${contact}`,
        created,
      ],
    );
    await db.query(
      "insert into commercial_agent_drafts(id,organization_id,event_id,contact_id,conversation_id,location_id,message_id,contact_version,state,payload,reply_hash,policy_hash,flags,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        draftId,
        organization,
        eventId,
        contact,
        `conversation-${contact}`,
        location,
        `message-${contact}`,
        options.contactVersion ?? 1,
        options.state ?? "pending",
        options.empty ? "" : "synthetic-not-decrypted",
        "a".repeat(64),
        options.policy ?? POLICY_HASH,
        options.flags ?? [],
        created,
        new Date(startedAt + (options.expired ? -1000 : 3600_000)).toISOString(),
      ],
    );
    return { eventId, draftId };
  }
  async function read(options: Record<string, unknown> = {}) {
    const p = {
      org,
      location: "location-main",
      actor,
      kind: "drafts",
      category: "review",
      query: "",
      page: 1,
      pageSize: 25,
      asOf: null,
      policy: POLICY_HASH,
      ...options,
    };
    const result = await db.query<{ result: SqlProjection }>(
      "select commercial_agent_queue_read($1::uuid,$2,$3::uuid,$4,$5,$6,$7::integer,$8::integer,$9::timestamptz,$10) as result",
      Object.values(p),
    );
    return result.rows[0]!.result;
  }
  beforeAll(async () => {
    const { PGlite } = await import(pathToFileURL(modulePath!).href);
    db = new PGlite() as EmbeddedDb;
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table organizations(id uuid primary key);
      create table profiles(id uuid primary key,organization_id uuid);
      create table user_roles(user_id uuid,organization_id uuid,role text);
      create table ghl_location_bindings(organization_id uuid,location_id text);
      create table contacts(organization_id uuid,ghl_contact_id text,full_name text,is_demo boolean default false,unique(organization_id,ghl_contact_id));
      insert into auth.users values('${actor}'),('${foreign}');
      insert into organizations values('${org}'),('${other}');
      insert into profiles values('${actor}','${org}'),('${foreign}','${other}');
      insert into user_roles values('${actor}','${org}','comercial'),('${foreign}','${other}','administrador');
      insert into ghl_location_bindings values('${org}','location-main'),('${other}','location-other');`);
    await db.exec(
      readFileSync("supabase/migrations/20261003120000_commercial_agent_supervised.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/20261008180000_commercial_agent_receive_all.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/20261112153000_commercial_agent_queue_read.sql", "utf8"),
    );
    await db.query(
      "insert into commercial_agent_settings(organization_id,location_id,mode) values($1,'location-main','supervised'),($2,'location-other','supervised')",
      [org, other],
    );
    await seedDraft("ana-review", { name: "Ana Clínica" });
    await seedDraft("bia-review", { name: "Bia Clínica" });
    await seedDraft("caio-review", { name: "Caio Clínica" });
    await seedDraft("paused-team", { paused: true });
    await seedDraft("flags-team", { flags: ["clinical"] });
    await seedDraft("unknown-expired", { state: "unknown", expired: true, empty: true });
    await seedDraft("sending-expired", { state: "sending", expired: true });
    await seedDraft("old-policy", { policy: "b".repeat(64) });
    await seedDraft("outdated-version", { contactVersion: 0 });
    await seedDraft("expired", { expired: true });
    await seedDraft("empty-payload", { empty: true });
    await seedDraft("tenant-foreign", { organization: other, name: "Ana Estrangeira" });
    for (let n = 0; n < 120; n++)
      await seedDraft(`history-${n}`, {
        state: "sent",
        createdAt: new Date(startedAt - 60_000).toISOString(),
      });
    const failed = await seedDraft("failure-history", { state: "invalidated" });
    await db.query(
      "update commercial_agent_inbox set state='failed',error_code='provider_unavailable' where id=$1",
      [failed.eventId],
    );
    const ignored = await seedDraft("ignored-history", { state: "invalidated" });
    await db.query(
      "update commercial_agent_inbox set state='ignored',error_code='newer_message_exists' where id=$1",
      [ignored.eventId],
    );
    await db.query("insert into contacts values($1,'no-draft','Marta Sem Rascunho',false);", [org]);
    await db.query(
      "insert into commercial_agent_sessions(organization_id,contact_id,version) values($1,'no-draft',1)",
      [org],
    );
    await db.query(
      "insert into commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state) values($1,$2,'no-draft','message-no-draft','InboundMessage',1,'ignored')",
      [
        org,
        JSON.stringify({
          type: "InboundMessage",
          locationId: "location-main",
          contactId: "no-draft",
          conversationId: "conversation-no-draft",
          messageId: "message-no-draft",
        }),
      ],
    );
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  it("filtra e conta antes do limite: encontra pendências anteriores aos 120 registros recentes", async () => {
    const result = await read({ pageSize: 2 });
    expect(result.counts).toEqual({ review: 3, team: 2, uncertain: 2, history: 126 });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((row) => row.category === "review")).toBe(true);
  });
  it("preserva precedência de envio incerto mesmo sem conteúdo e após expiração", async () => {
    const result = await read({ category: "uncertain" });
    expect(result.items.map((row) => row.contact_id).sort()).toEqual([
      "sending-expired",
      "unknown-expired",
    ]);
  });
  it("pesquisa o cadastro canônico dentro da organização antes de contar", async () => {
    const result = await read({ query: "ana" });
    expect(result.counts.review).toBe(1);
    expect(result.items[0]?.contact_name).toBe("Ana Clínica");
  });
  it("não transforma caracteres SQL ou curingas em busca irrestrita", async () => {
    expect((await read({ query: "%" })).counts.review).toBe(0);
    expect((await read({ query: "' OR true --" })).counts.review).toBe(0);
  });
  it("separa eventos ignorados das falhas e retorna o total além da amostra", async () => {
    const result = await read();
    expect(result.failedEventCount).toBe(1);
    expect(result.ignoredEventCount).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ state: "failed", error_code: "provider_unavailable" });
  });
  it("paginação empata por UUID e exclui entradas posteriores ao snapshot", async () => {
    const first = await read({ pageSize: 2 });
    await seedDraft("new-after-anchor", { createdAt: new Date().toISOString() });
    const second = await read({ pageSize: 2, page: 2, asOf: first.asOf });
    expect(second.counts.review).toBe(3);
    expect(second.items).toHaveLength(1);
    expect(first.items.map((row) => row.id)).not.toContain(second.items[0]?.id);
    expect(second.items[0]?.contact_id).not.toBe("new-after-anchor");
  });
  it("busca manual encontra nome mesmo sem nenhum rascunho retido", async () => {
    const result = await read({ kind: "manual", query: "Marta" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      contactId: "no-draft",
      contactName: "Marta Sem Rascunho",
      channel: null,
      lastMessageAt: null,
    });
  });
  it("nega ator de outra clínica, location arbitrária e vínculo divergente", async () => {
    expect(await read({ actor: foreign })).toEqual({ error: "forbidden" });
    expect(await read({ location: "location-other" })).toEqual({ error: "scope_mismatch" });
    expect(await read({ org: other, location: "location-other" })).toEqual({ error: "forbidden" });
  });
  it("não expõe execução da RPC para usuários anon/authenticated", async () => {
    const result = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`select
      has_function_privilege('anon','commercial_agent_queue_read(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text)','execute') as anon,
      has_function_privilege('authenticated','commercial_agent_queue_read(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text)','execute') as authenticated,
      has_function_privilege('service_role','commercial_agent_queue_read(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text)','execute') as service`);
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });
  it("leitura não muda estados, payload, lease ou histórico de auditoria", async () => {
    const state = async () =>
      (
        await db.query(
          "select (select jsonb_agg(d order by id) from commercial_agent_drafts d) as drafts, (select jsonb_agg(i order by id) from commercial_agent_inbox i) as inbox, (select count(*) from commercial_agent_audit) as audit",
        )
      ).rows;
    const before = await state();
    await read();
    await read({ category: "history" });
    await read({ kind: "manual" });
    expect(await state()).toEqual(before);
  });
  it("mantém a retenção de sete dias na leitura, sem apagar a evidência de envio incerto", async () => {
    const oldDate = new Date(startedAt - 8 * 24 * 3600_000).toISOString();
    const old = await seedDraft("old-content", { createdAt: oldDate, state: "sent" });
    await seedDraft("old-unknown", { createdAt: oldDate, state: "unknown" });
    const history = await read({ category: "history", query: "old-content" });
    expect(history.items[0]).toMatchObject({ payload: "" });
    const unknown = await read({ category: "uncertain", query: "old-unknown" });
    expect(unknown.items[0]).toMatchObject({ payload: "synthetic-not-decrypted" });
    const stored = await db.query("select payload from commercial_agent_drafts where id=$1", [
      old.draftId,
    ]);
    expect(stored.rows[0]).toMatchObject({ payload: "synthetic-not-decrypted" });
  });
});
