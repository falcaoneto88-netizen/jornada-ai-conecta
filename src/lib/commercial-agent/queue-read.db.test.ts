import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { AUTOMATION_POLICY_HASH, POLICY_HASH } from "./providers.server";
import { startCommercialDb } from "../../../test/commercial-agent-db";

// Optional isolated PostgreSQL/WASM harness. No production URL, credentials or network.
// JORNADA_QUEUE_PGLITE_MODULE points to a separately installed temporary pglite/dist/index.js.
const modulePath = process.env["JORNADA_QUEUE_PGLITE_MODULE"];
const postgresPath = process.env["PG_TEST_BINDIR"];
const databaseAvailable = Boolean(modulePath || postgresPath);
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
describe.skipIf(!databaseAvailable)("projeção SQL isolada da fila", () => {
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
      automaticDispatch?: boolean;
      messageId?: string;
    } = {},
  ) {
    const organization = options.organization ?? org;
    const location = organization === org ? "location-main" : "location-other";
    const eventId = randomUUID(),
      draftId = randomUUID();
    const created = options.createdAt ?? new Date(startedAt - 3600_000).toISOString();
    const messageId = options.messageId ?? `message-${contact}`;
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
          messageId,
        }),
        contact,
        messageId,
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
        messageId,
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
    if (options.automaticDispatch)
      await db.query(
        "update commercial_agent_drafts set dispatch_origin='automatic', automation_version=1, automation_channel='SMS', automation_authorized_by=$2, automation_authorized_at=created_at where id=$1",
        [draftId, actor],
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
      automaticPolicy: AUTOMATION_POLICY_HASH,
      ...options,
    };
    const result = await db.query<{ result: SqlProjection }>(
      "select commercial_agent_queue_read_v2($1::uuid,$2,$3::uuid,$4,$5,$6,$7::integer,$8::integer,$9::timestamptz,$10,$11) as result",
      Object.values(p),
    );
    return result.rows[0]!.result;
  }
  beforeAll(async () => {
    if (postgresPath) {
      const runtime = await startCommercialDb();
      db = {
        async exec(statement) {
          const connection = await runtime.sql.reserve();
          try {
            return await connection.unsafe(statement);
          } finally {
            connection.release();
          }
        },
        async query<T>(statement: string, params: unknown[] = []) {
          // PGlite accepts serialized JSON; postgres.js serializes JSONB parameters itself.
          const values = params.map((value) =>
            typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value,
          );
          const rows = await runtime.sql.unsafe(statement, values as never[]);
          return { rows: [...rows] as T[] };
        },
        close: runtime.stop,
      };
      await db.exec(`create table contacts(organization_id uuid,ghl_contact_id text,full_name text,is_demo boolean default false,unique(organization_id,ghl_contact_id));
        update ghl_location_bindings set location_id=case when organization_id='${org}' then 'location-main' else 'location-other' end;`);
    } else {
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
        readFileSync(
          "supabase/migrations/20261117160000_commercial_agent_global_automation.sql",
          "utf8",
        ),
      );
    }
    await db.exec(
      readFileSync("supabase/migrations/20261112153000_commercial_agent_queue_read.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261117170000_commercial_agent_automation_queue.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261120180000_commercial_agent_pending_handoffs.sql",
        "utf8",
      ),
    );
    await db.query(
      "insert into commercial_agent_settings(organization_id,location_id,mode) values($1,'location-main','supervised'),($2,'location-other','supervised') on conflict(organization_id) do update set location_id=excluded.location_id",
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
    expect(result.errors[0]).toMatchObject({
      state: "failed",
      error_code: "provider_unavailable",
    });
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
    expect(await read({ org: other, location: "location-other" })).toEqual({
      error: "forbidden",
    });
  });
  it("não expõe execução da RPC para usuários anon/authenticated", async () => {
    const result = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`select
      has_function_privilege('anon','commercial_agent_queue_read_v2(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text,text)','execute') as anon,
      has_function_privilege('authenticated','commercial_agent_queue_read_v2(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text,text)','execute') as authenticated,
      has_function_privilege('service_role','commercial_agent_queue_read_v2(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text,text)','execute') as service`);
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
  it("mostra propostas automáticas atuais na equipe, sem confundir com política antiga ou aprovação humana", async () => {
    await seedDraft("auto-pending", { policy: AUTOMATION_POLICY_HASH });
    await seedDraft("auto-paused", { policy: AUTOMATION_POLICY_HASH, paused: true });
    await seedDraft("auto-clinical", { policy: AUTOMATION_POLICY_HASH, flags: ["clinical"] });
    await seedDraft("auto-expired", { policy: AUTOMATION_POLICY_HASH, expired: true });
    await seedDraft("auto-unknown", {
      policy: AUTOMATION_POLICY_HASH,
      state: "unknown",
      expired: true,
      automaticDispatch: true,
    });
    await seedDraft("auto-sent", {
      policy: AUTOMATION_POLICY_HASH,
      state: "sent",
      automaticDispatch: true,
    });
    await seedDraft("auto-foreign", { policy: AUTOMATION_POLICY_HASH, organization: other });
    const result = await read({ query: "auto-", category: "team", pageSize: 2 });
    expect(result.counts).toEqual({ review: 0, team: 3, uncertain: 1, history: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((row) => row.category === "team")).toBe(true);
    const next = await read({
      query: "auto-",
      category: "team",
      page: 2,
      pageSize: 2,
      asOf: result.asOf,
    });
    expect(next.items).toHaveLength(1);
    expect([...result.items, ...next.items].map((row) => row.contact_id).sort()).toEqual([
      "auto-clinical",
      "auto-paused",
      "auto-pending",
    ]);
    expect(result.items.map((row) => row.id)).not.toContain(next.items[0]!.id);
    const uncertain = await read({ query: "auto-", category: "uncertain" });
    expect(uncertain.items[0]).toMatchObject({
      contact_id: "auto-unknown",
      category: "uncertain",
      dispatch_origin: "automatic",
      approved_at: null,
      automation_authorized_by: actor,
    });
    expect(uncertain.items[0]).not.toHaveProperty("approved_by");
    const old = await read({
      query: "auto-",
      category: "history",
      automaticPolicy: "f".repeat(64),
    });
    expect(old.counts).toEqual({ review: 0, team: 0, uncertain: 1, history: 5 });
  });
  it("valida ambas as políticas sem fallback para a RPC anterior", async () => {
    for (const automaticPolicy of ["", null, "invalid", POLICY_HASH])
      expect(await read({ automaticPolicy })).toEqual({ error: "invalid_request" });
    // Existing callers retain the original V1 function during rolling deployment.
    const legacy = await db.query<{ result: { counts: { review: number } } }>(
      "select commercial_agent_queue_read($1::uuid,$2,$3::uuid,'drafts','review','ana-review',1,25,null,$4) as result",
      [org, "location-main", actor, POLICY_HASH],
    );
    expect(legacy.rows[0]!.result.counts.review).toBe(1);
  });
  it("mantém encaminhamento auditado visível após automation_block invalidar a proposta e avançar a sessão", async () => {
    const blocked = await seedDraft("automatic-block-handoff", {
      policy: AUTOMATION_POLICY_HASH,
    });
    const transition = await db.query<{ result: { status: string } }>(
      "select commercial_agent_automation_command('automation_block',$1::uuid,$2::jsonb,null) as result",
      [org, JSON.stringify({ draftId: blocked.draftId, code: "contact_not_verified" })],
    );
    expect(transition.rows[0]!.result.status).toBe("blocked");
    // The sending deadline may expire while an attendant is still addressing the handoff.
    await db.query(
      "update commercial_agent_drafts set expires_at=now()-interval '1 minute' where id=$1",
      [blocked.draftId],
    );
    const result = await read({ category: "team", query: "automatic-block-handoff" });
    expect(result.counts).toEqual({ review: 0, team: 1, uncertain: 0, history: 0 });
    expect(result.items[0]).toMatchObject({
      state: "invalidated",
      error_code: "contact_not_verified",
      paused: true,
      contact_version: 1,
      session_version: 2,
      dispatch_origin: "supervised",
    });
    await db.query(
      "update commercial_agent_sessions set paused=false where organization_id=$1 and contact_id='automatic-block-handoff'",
      [org],
    );
    const released = await read({ category: "history", query: "automatic-block-handoff" });
    expect(released.counts).toEqual({ review: 0, team: 0, uncertain: 0, history: 1 });
  });
  it("não promove invalidação genérica com o mesmo código de erro sem evidência de encaminhamento automático", async () => {
    const generic = await seedDraft("unaudited-invalidated", {
      policy: AUTOMATION_POLICY_HASH,
      state: "invalidated",
      paused: true,
    });
    await db.query(
      "update commercial_agent_drafts set error_code='contact_not_verified' where id=$1",
      [generic.draftId],
    );
    const result = await read({ category: "history", query: "unaudited-invalidated" });
    expect(result.counts).toEqual({ review: 0, team: 0, uncertain: 0, history: 1 });
  });

  it("mantém o handoff sinalizado visível após nova entrada e não retoma nem reprocessa pela leitura", async () => {
    const contactId = "flagged-handoff-followup";
    const command = async (
      operation: string,
      data: Record<string, unknown>,
      actorId: string | null = null,
    ) => {
      const response = await db.query<{ result: Record<string, unknown> }>(
        "select commercial_agent_command($1,$2::uuid,$3::jsonb,$4::uuid) as result",
        [operation, org, JSON.stringify(data), actorId],
      );
      return response.rows[0]!.result;
    };
    await db.query(
      "update commercial_agent_settings set allowed_contacts=array_append(allowed_contacts,$2) where organization_id=$1",
      [org, contactId],
    );
    const event = {
      type: "InboundMessage",
      locationId: "location-main",
      contactId,
      conversationId: "conversation-flagged-handoff-followup",
      messageId: "message-flagged-handoff-original",
      observedAt: new Date(startedAt - 120_000).toISOString(),
    };
    expect(await command("ingress", event)).toMatchObject({ status: "accepted" });
    const job = await command("claim", {});
    const prepared = await command("ready", {
      id: job["id"],
      lease: job["lease"],
      payload: "synthetic-not-decrypted",
      replyHash: "a".repeat(64),
      policyHash: AUTOMATION_POLICY_HASH,
      flags: ["commercial_conflict"],
      observedAt: event.observedAt,
      pause: true,
      optOut: false,
    });
    expect(prepared).toMatchObject({ status: "ready" });
    expect(
      await command("ingress", {
        ...event,
        messageId: "message-flagged-handoff-followup",
        observedAt: new Date(startedAt - 60_000).toISOString(),
      }),
    ).toMatchObject({ status: "accepted" });
    const before = await db.query(
      "select version,paused,opt_out from commercial_agent_sessions where organization_id=$1 and contact_id=$2",
      [org, contactId],
    );
    const result = await read({ category: "team", query: contactId });
    expect(result.counts).toEqual({ review: 0, team: 1, uncertain: 0, history: 0 });
    expect(result.items[0]).toMatchObject({
      id: prepared["id"],
      state: "invalidated",
      paused: true,
      contact_version: 1,
      session_version: 2,
    });
    expect(
      await db.query(
        "select version,paused,opt_out from commercial_agent_sessions where organization_id=$1 and contact_id=$2",
        [org, contactId],
      ),
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select state from commercial_agent_inbox where organization_id=$1 and message_id=$2",
          [org, "message-flagged-handoff-followup"],
        )
      ).rows,
    ).toEqual([{ state: "ignored" }]);

    expect(await command("resume", { contactId, expectedVersion: 2 }, actor)).toMatchObject({
      paused: false,
      version: 3,
    });
    const released = await read({ category: "history", query: contactId });
    expect(released.counts).toEqual({ review: 0, team: 0, uncertain: 0, history: 1 });
    expect(
      (
        await db.query(
          "select state from commercial_agent_inbox where organization_id=$1 and message_id=$2",
          [org, "message-flagged-handoff-followup"],
        )
      ).rows,
    ).toEqual([{ state: "ignored" }]);
  });

  it.each(["commercial_conflict", "unsupported_attachment", "clinical"])(
    "preserva %s em Com a equipe após expirar ou mudar a política, sem liberar aprovação",
    async (flag) => {
      const contact = `flagged-visible-${flag}`;
      await seedDraft(contact, {
        state: "invalidated",
        paused: true,
        flags: [flag],
        expired: true,
        policy: "b".repeat(64),
        contactVersion: 0,
      });
      const result = await read({ category: "team", query: contact });
      expect(result.counts).toEqual({ review: 0, team: 1, uncertain: 0, history: 0 });
      expect(result.items[0]).toMatchObject({ state: "invalidated", paused: true });
    },
  );

  it("não ressuscita um handoff antigo após existir um rascunho posterior concluído", async () => {
    const contact = "flagged-handoff-superseded";
    await seedDraft(contact, {
      state: "invalidated",
      paused: true,
      flags: ["commercial_conflict"],
    });
    await seedDraft(contact, {
      messageId: "message-flagged-handoff-superseded-newer",
      state: "sent",
      createdAt: new Date(startedAt - 60_000).toISOString(),
    });
    const result = await read({ category: "history", query: contact });
    expect(result.counts).toEqual({ review: 0, team: 0, uncertain: 0, history: 2 });
  });

  it.each(["sent", "rejected", "empty", "retained-too-long", "opt-out", "unpaused"])(
    "não promove o registro sinalizado %s nem altera a pausa ou recusa",
    async (kind) => {
      const contact = `flagged-excluded-${kind}`;
      await seedDraft(contact, {
        state: ["sent", "rejected"].includes(kind) ? kind : "invalidated",
        paused: kind !== "unpaused",
        flags: ["commercial_conflict"],
        empty: kind === "empty",
        ...(kind === "retained-too-long"
          ? { createdAt: new Date(startedAt - 8 * 86_400_000).toISOString() }
          : {}),
      });
      if (kind === "opt-out")
        await db.query(
          "update commercial_agent_sessions set opt_out=true where organization_id=$1 and contact_id=$2",
          [org, contact],
        );
      const before = await db.query(
        "select version,paused,opt_out from commercial_agent_sessions where organization_id=$1 and contact_id=$2",
        [org, contact],
      );
      const result = await read({ category: "history", query: contact });
      expect(result.counts).toEqual({ review: 0, team: 0, uncertain: 0, history: 1 });
      expect(
        await db.query(
          "select version,paused,opt_out from commercial_agent_sessions where organization_id=$1 and contact_id=$2",
          [org, contact],
        ),
      ).toEqual(before);
    },
  );

  it("mantém a correção aditiva equivalente nos dois envelopes sem escrita de dados", () => {
    const migration = readFileSync(
      "supabase/migrations/20261120180000_commercial_agent_pending_handoffs.sql",
      "utf8",
    );
    // The deployed Drizzle runner owns its transaction; Supabase retains an explicit envelope.
    const withoutTransaction = (sql: string) =>
      sql
        .replace(/^\s*begin;\s*/i, "")
        .replace(/\s*commit;\s*$/i, "")
        .trim();
    expect(
      withoutTransaction(
        readFileSync("drizzle/migrations/0031_commercial_agent_pending_handoffs.sql", "utf8"),
      ),
    ).toBe(withoutTransaction(migration));
    expect(migration).toContain("create or replace function public.commercial_agent_queue_read_v2");
    expect(migration).not.toMatch(/\b(?:insert into|update public|delete from|alter table)\b/i);
  });

  it("preserva o SQL da migração anterior nos dois envelopes transacionais", () => {
    const migration = readFileSync(
      "supabase/migrations/20261117170000_commercial_agent_automation_queue.sql",
      "utf8",
    );
    // The deployed Drizzle runner owns its transaction; Supabase retains an explicit envelope.
    const withoutTransaction = (sql: string) =>
      sql
        .replace(/^\s*begin;\s*/i, "")
        .replace(/\s*commit;\s*$/i, "")
        .trim();
    expect(
      withoutTransaction(
        readFileSync("drizzle/migrations/0030_commercial_agent_automation_queue.sql", "utf8"),
      ),
    ).toBe(withoutTransaction(migration));
    expect(migration).not.toMatch(/\b(?:insert into|update public|delete from|alter table)\b/i);
  });
});
