import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertIzabelKnowledgeScope,
  isIzabelV03TextEligible,
  izabelV03LibraryObjectPath,
  izabelV03ReplyViolation,
  IZABEL_V03_LIBRARY_SHA256,
  IZABEL_V03_POLICY,
  IZABEL_V03_POLICY_MATERIAL,
  IZABEL_V03_VERSION,
  loadIzabelV03Reference,
} from "./knowledge-v03.server";

const scope = {
  organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
// Synthetic content only. Private owner records are never included in this repository.
const record = {
  id: "SYNTHETIC",
  phase: "fixture",
  intents: ["fixture"],
  text: "Synthetic reference for contract validation.",
  language: "pt",
  mode: "bounded",
  status: "approved_owner",
  scope: "commercial",
  source_id: "DESIGN_V1",
  source_pages: [],
  guards: [] as string[],
  note: "Synthetic test fixture, not clinic policy.",
};
function payload() {
  return {
    schema_version: 1,
    provenance: {
      source_file_sha256: "ba61398af8e9b42100764564594e941fe3fe9a40dfb9f45f521555e8c0b218c9",
      source_manifest_sha256: "393f11da2a8ad05037df38858a709b5219af6729bcf262ecc4737b67d6b75edb",
      training_version: "V03",
      original_records: 78,
      selected_records: 30,
      media_included: false,
      raw_sources_included: false,
    },
    records: Array.from({ length: 30 }, (_, index) => {
      const value = { ...record, id: `SYNTHETIC_${index}` };
      return {
        record: value,
        source_version: "V03_PACKAGE_1_0_0",
        source_record_sha256: hash(JSON.stringify(value)),
      };
    }),
  };
}
function storageFixture(content = JSON.stringify(payload())) {
  const getBucket = vi.fn(async () => ({ data: { public: false }, error: null }));
  const download = vi.fn(async () => ({ data: new Blob([content]), error: null }));
  const from = vi.fn(() => ({ download }));
  return {
    configuration: { ...scope, bucket: "synthetic-private", sha256: hash(content) },
    storage: { getBucket, from },
    getBucket,
    download,
    from,
  };
}

describe("shared V03 reference boundary", () => {
  it("binds policy invalidation to rules, version and pinned private artifact", () => {
    const material = JSON.parse(IZABEL_V03_POLICY_MATERIAL);
    expect(material).toMatchObject({
      version: IZABEL_V03_VERSION,
      policy: IZABEL_V03_POLICY,
      librarySha256: IZABEL_V03_LIBRARY_SHA256,
    });
    expect(IZABEL_V03_LIBRARY_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(material).not.toHaveProperty("reference");
  });

  it.each(["approved_owner", "draft_supervised"])("allows %s only for reviewed text", (status) => {
    expect(isIzabelV03TextEligible({ ...record, status })).toBe(true);
  });
  it.each(["conditional_review", "human_only", "deprecated_for_ai", "approved", "future"])(
    "rejects status %s without promotion",
    (status) => expect(isIzabelV03TextEligible({ ...record, status })).toBe(false),
  );
  it("excludes the unsupported date-invitation capability even without guards", () => {
    expect(isIzabelV03TextEligible({ ...record, id: "CONVITE_DATAS" })).toBe(false);
  });
  it("rejects noncommercial scope and malformed records", () => {
    expect(isIzabelV03TextEligible({ ...record, scope: "human_only" })).toBe(false);
    expect(isIzabelV03TextEligible({ ...record, guards: undefined })).toBe(false);
    expect(isIzabelV03TextEligible({ ...record, source_pages: [19] })).toBe(false);
    expect(isIzabelV03TextEligible({ ...record, hiddenPolicy: "unexpected" })).toBe(false);
  });
  it("satisfies only the deterministic text-only card condition", () => {
    expect(
      isIzabelV03TextEligible({ ...record, guards: ["card_unavailable_or_text_requested"] }),
    ).toBe(true);
    expect(
      isIzabelV03TextEligible({
        ...record,
        guards: ["card_unavailable_or_text_requested", "new_guard"],
      }),
    ).toBe(false);
  });
  it.each([
    ["PRECO_REFERENCIA", "gluteal_only"],
    ["TRANSFERIR_6_4", "transfer_now_and_pause"],
    ["TRANSFERIR_6_5", "actual_refusal"],
    ["DOR", "not_postprocedure_complaint"],
    ["ACADEMIA", "not_personal_clearance"],
    ["VALIDAR_RESULTADO_GLUTEO", "media_send_accepted"],
    ["VIDEO_AUTORIDADE", "approved_video_exists"],
    ["CONSULTA_ONLINE", "online_available_for_unit_and_service"],
    ["UNKNOWN_FUTURE", "unrecognized_guard"],
  ])("keeps %s excluded when its guard is unverified", (id, guard) => {
    expect(isIzabelV03TextEligible({ ...record, id, guards: [guard] })).toBe(false);
  });

  it("rejects wrong org/location before storage access and exposes no identifiers", async () => {
    const fixture = storageFixture();
    for (const wrong of [
      { ...scope, organizationId: "another-organization" },
      { ...scope, locationId: "another-location" },
    ]) {
      await expect(loadIzabelV03Reference(wrong, fixture)).rejects.toThrow(
        /^izabel_knowledge_scope_mismatch$/,
      );
    }
    expect(fixture.getBucket).not.toHaveBeenCalled();
    expect(() => assertIzabelKnowledgeScope(scope.organizationId, scope.locationId)).not.toThrow();
  });
  it("rejects mismatched server configuration before I/O", async () => {
    const fixture = storageFixture();
    fixture.configuration.locationId = "other-location";
    await expect(loadIzabelV03Reference(scope, fixture)).rejects.toThrow(
      "izabel_knowledge_scope_mismatch",
    );
    expect(fixture.getBucket).not.toHaveBeenCalled();
  });
  it("requires configuration without falling back to public material", async () => {
    const fixture = storageFixture();
    await expect(
      loadIzabelV03Reference(scope, { ...fixture, configuration: null }),
    ).rejects.toThrow("izabel_knowledge_not_configured");
    expect(fixture.getBucket).not.toHaveBeenCalled();
  });
  it("loads a scoped private object and preserves exact source records", async () => {
    const fixture = storageFixture();
    const result = JSON.parse(await loadIzabelV03Reference(scope, fixture));
    expect(fixture.getBucket).toHaveBeenCalledWith("synthetic-private");
    expect(fixture.download).toHaveBeenCalledWith(izabelV03LibraryObjectPath(scope));
    expect(result.records).toEqual(payload().records);
  });
  it("rejects a public bucket before download", async () => {
    const fixture = storageFixture();
    fixture.getBucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(loadIzabelV03Reference(scope, fixture)).rejects.toThrow(
      "izabel_knowledge_storage_not_private",
    );
    expect(fixture.download).not.toHaveBeenCalled();
  });
  it("sanitizes storage exceptions", async () => {
    const fixture = storageFixture();
    fixture.download.mockRejectedValue(new Error("private signed URL and credential"));
    await expect(loadIzabelV03Reference(scope, fixture)).rejects.toThrow(
      /^izabel_knowledge_unavailable$/,
    );
  });
  it("rejects byte changes before trusting JSON", async () => {
    const fixture = storageFixture();
    fixture.download.mockResolvedValue({
      data: new Blob(["not-json-private-secret"]),
      error: null,
    });
    await expect(loadIzabelV03Reference(scope, fixture)).rejects.toThrow(
      /^izabel_knowledge_integrity_failed$/,
    );
  });
  it("bounds payload size", async () => {
    const fixture = storageFixture("x".repeat(256 * 1024 + 1));
    await expect(loadIzabelV03Reference(scope, fixture)).rejects.toThrow(
      "izabel_knowledge_integrity_failed",
    );
  });
  it.each(["source", "record", "guard", "duplicate", "version", "count"])(
    "rejects invalid %s even with a trusted synthetic transport hash",
    async (kind) => {
      const data = payload();
      if (kind === "source") data.provenance.source_file_sha256 = "0".repeat(64);
      if (kind === "record") data.records[0]!.record.text += "tampered";
      if (kind === "guard") {
        data.records[0]!.record.guards = ["unknown"];
        data.records[0]!.source_record_sha256 = hash(JSON.stringify(data.records[0]!.record));
      }
      if (kind === "duplicate") data.records[1] = data.records[0]!;
      if (kind === "version") data.records[0]!.source_version = "another-version";
      if (kind === "count") data.records.pop();
      await expect(
        loadIzabelV03Reference(scope, storageFixture(JSON.stringify(data))),
      ).rejects.toThrow(/^izabel_knowledge_integrity_failed$/);
    },
  );
});

describe("V03 generated reply review guard", () => {
  it.each([
    "Olá, [lead].",
    "A consulta é [PENDENTE: appointment.only_start_date].",
    "Olá, {{contact.first_name}}.",
    "Consulta: appointment.start_time.",
    "Cliente: contact.name.",
    "Local: location.address.",
    "PENDENTE: confirmar horário.",
    "Um marcador incompleto [",
    "Outro marcador incompleto }}",
  ])("blocks technical placeholder: %s", (text) => {
    expect(izabelV03ReplyViolation(text)).toBe(true);
  });
  it.each([
    "Olá, Ana! Posso esclarecer a sua dúvida?",
    "You can ask the team about your appointment.",
    "We can discuss the location.",
    "Pode contactar a equipa quando precisar.",
  ])("preserves normal patient wording: %s", (text) => {
    expect(izabelV03ReplyViolation(text)).toBe(false);
  });
  it.each([
    "A política V02 permite isso.",
    "Base V03 ativa.",
    "É a versão V04.",
    "O procedimento custa 1.600 €.",
    "A partir de 1600 euros.",
    "O preço é mil e seiscentos euros.",
    "The price is one thousand six hundred euros.",
    "Preço: 1 600 €.",
    "Durabilidade de 20 meses.",
    "Dura um ano e oito meses.",
    "Lasts one year and eight months.",
    "Dure un an et huit mois.",
    "Dura un año y ocho meses.",
    "A consulta é separada do procedimento.",
    "A consulta é cobrada separadamente do procedimento.",
    "A consulta custa 50 euros adicionais.",
    "O valor será abatido no procedimento.",
    "A consulta não é abatida do procedimento.",
    "O valor será convertido em crédito.",
    "La consultation est facturée séparément.",
    "Les frais de consultation sont déduits du traitement.",
    "Consultation is charged separately.",
    "The consultation fee is separate from the procedure.",
    "The consultation costs 50 euros extra.",
    "The consultation fee is credited towards the procedure.",
    "La consulta se cobra aparte.",
    "El valor de la consulta es un crédito para el tratamiento.",
    "A consulta está incluída no procedimento.",
    "Não tenho a política confirmada, mas o valor será abatido.",
    "Não tenho a política de abatimento confirmada, e a consulta será abatida.",
    "I cannot confirm the policy; the consultation is deducted from the procedure.",
  ])("blocks unsupported assertion: %s", (text) => {
    expect(izabelV03ReplyViolation(text)).toBe(true);
  });
  it.each([
    "Não tenho a política de abatimento confirmada.",
    "Não posso afirmar que o valor será abatido.",
    "A relação de crédito está indefinida.",
    "I cannot confirm whether consultation costs are deducted.",
    "Je ne peux pas confirmer que la consultation est déduite.",
    "No tengo la política de crédito confirmada.",
    "No puedo confirmar que la consulta se descuenta.",
    "A consulta tem valor de 50 euros.",
    "Pode esclarecer a sua dúvida?",
    "A avaliação permite discutir o planejamento individual.",
  ])("allows natural uncertainty or eligible general reply: %s", (text) => {
    expect(izabelV03ReplyViolation(text)).toBe(false);
  });
});
