import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  isIzabelV03AutomaticTextEligible,
  isIzabelV03TextEligible,
  IZABEL_V03_AUTOMATION_POLICY,
  IZABEL_V03_AUTOMATION_POLICY_MATERIAL,
  IZABEL_V03_LIBRARY_SHA256,
  loadIzabelV03AutomaticReference,
  loadIzabelV03Reference,
} from "./knowledge-v03.server";

const scope = {
  organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const record = {
  id: "SYNTHETIC",
  phase: "fixture",
  intents: ["fixture"],
  text: "Synthetic approved commercial reference, not a clinical rule.",
  language: "pt",
  mode: "fixed_facts",
  status: "approved_owner",
  scope: "commercial",
  source_id: "DESIGN_V1",
  source_pages: [],
  guards: [] as string[],
  note: "Synthetic fixture.",
};
function fixture(approvedCount = 2) {
  const records = Array.from({ length: 30 }, (_, index) => {
    const value = {
      ...record,
      id: `SYNTHETIC_${index}`,
      status: index < approvedCount ? "approved_owner" : "draft_supervised",
    };
    return {
      record: value,
      source_version: "V03_PACKAGE_1_0_0",
      source_record_sha256: hash(JSON.stringify(value)),
    };
  });
  const content = JSON.stringify({
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
    records,
  });
  const getBucket = vi.fn(async () => ({ data: { public: false }, error: null }));
  const download = vi.fn(async () => ({ data: new Blob([content]), error: null }));
  return {
    records,
    content,
    configuration: { ...scope, bucket: "synthetic-private", sha256: hash(content) },
    storage: { getBucket, from: vi.fn(() => ({ download })) },
    getBucket,
    download,
  };
}

describe("automatic V03 private knowledge selection", () => {
  it("keeps the full supervised object intact and selects approved records only in memory", async () => {
    const input = fixture();
    const supervised = JSON.parse(await loadIzabelV03Reference(scope, input));
    const automatic = JSON.parse(await loadIzabelV03AutomaticReference(scope, input));
    expect(supervised.records).toEqual(input.records);
    expect(automatic.records).toEqual(input.records.slice(0, 2));
    expect(automatic.provenance).toMatchObject({
      selected_records: 2,
      selection: "automatic_approved_owner",
    });
    expect(input.configuration.sha256).toBe(hash(input.content));
    expect(automatic.records[0].source_record_sha256).toBe(input.records[0]!.source_record_sha256);
  });

  it.each([
    "draft_supervised",
    "conditional_review",
    "human_only",
    "deprecated_for_ai",
    "approved",
  ])("does not promote %s to automatic eligibility", (status) => {
    expect(isIzabelV03AutomaticTextEligible({ ...record, status })).toBe(false);
    if (status === "draft_supervised")
      expect(isIzabelV03TextEligible({ ...record, status })).toBe(true);
  });

  it("preserves source guards, commercial scope and the excluded calendar capability", () => {
    expect(isIzabelV03AutomaticTextEligible(record)).toBe(true);
    expect(
      isIzabelV03AutomaticTextEligible({
        ...record,
        guards: ["card_unavailable_or_text_requested"],
      }),
    ).toBe(true);
    expect(isIzabelV03AutomaticTextEligible({ ...record, guards: ["unverified_capability"] })).toBe(
      false,
    );
    expect(isIzabelV03AutomaticTextEligible({ ...record, scope: "human_only" })).toBe(false);
    expect(isIzabelV03AutomaticTextEligible({ ...record, id: "CONVITE_DATAS" })).toBe(false);
  });

  it("fails closed if there is no approved source instead of using supervised drafts", async () => {
    await expect(loadIzabelV03AutomaticReference(scope, fixture(0))).rejects.toThrow(
      "izabel_knowledge_no_automatic_reference",
    );
  });

  it("checks private storage and full object integrity before selecting any record", async () => {
    const input = fixture();
    input.download.mockResolvedValue({ data: new Blob([input.content + "tampered"]), error: null });
    await expect(loadIzabelV03AutomaticReference(scope, input)).rejects.toThrow(
      "izabel_knowledge_integrity_failed",
    );
    input.getBucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(loadIzabelV03AutomaticReference(scope, input)).rejects.toThrow(
      "izabel_knowledge_storage_not_private",
    );
  });

  it("rejects a foreign organization before any storage access", async () => {
    const input = fixture();
    await expect(
      loadIzabelV03AutomaticReference({ ...scope, organizationId: "foreign-organization" }, input),
    ).rejects.toThrow("izabel_knowledge_scope_mismatch");
    expect(input.getBucket).not.toHaveBeenCalled();
  });

  it("has an independent policy tied to the same pinned original library", () => {
    expect(JSON.parse(IZABEL_V03_AUTOMATION_POLICY_MATERIAL)).toMatchObject({
      policy: IZABEL_V03_AUTOMATION_POLICY,
      librarySha256: IZABEL_V03_LIBRARY_SHA256,
      selection: "automatic_approved_owner",
    });
    expect(IZABEL_V03_AUTOMATION_POLICY).not.toMatch(
      /O humano decide o envio|apenas rascunhos.*revisão humana/,
    );
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain("fixed_facts preserva todos os fatos");
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain(
      "nem o valor documental de 50 € pode ser oferecido automaticamente",
    );
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain("O servidor decide");
  });

  it("bounds the neutral budget example to eligible evidence and no independent hold", () => {
    const expected = {
      reply:
        "O orçamento do procedimento só é definido em consulta. Posso explicar como funciona a consulta?",
      flags: [],
      handoff: false,
      optOut: false,
      sourceRecordIds: ["PRECO_INICIAL"],
    };
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain(JSON.stringify(expected));
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain(
      "com PRECO_INICIAL presente na referência approved_owner e sem outro impedimento",
    );
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain(
      "não autoriza omitir uma flag ou handoff justificados",
    );
    expect(IZABEL_V03_AUTOMATION_POLICY).toContain(
      "Não copia a fonte do exemplo se ela não estiver na referência elegível",
    );
  });
});
