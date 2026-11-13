import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AgentError, type DraftRow, type SessionRow } from "./core";

export type InboxReviewScope = {
  organizationId: string;
  locationId: string;
  contactId: string;
  conversationId: string;
  draftId?: string;
};
export type InboxReviewRows = { items: DraftRow[]; session: SessionRow | null; truncated: boolean };

/** Called only after authenticatedAgent. Filters precede the limit; never reads the global queue. */
export async function readInboxReviewRows(
  client: SupabaseClient<Database>,
  scope: InboxReviewScope,
): Promise<InboxReviewRows> {
  let drafts = client
    .from("commercial_agent_drafts")
    .select(
      "id,organization_id,event_id,contact_id,conversation_id,location_id,message_id,state,version,contact_version,payload,reply_hash,expires_at,created_at,result_message_id,error_code",
    )
    .eq("organization_id", scope.organizationId)
    .eq("location_id", scope.locationId)
    .eq("contact_id", scope.contactId)
    .eq("conversation_id", scope.conversationId);
  if (scope.draftId) drafts = drafts.eq("id", scope.draftId);
  const [rows, session] = await Promise.all([
    drafts.order("created_at", { ascending: false }).limit(31),
    client
      .from("commercial_agent_sessions")
      .select("contact_id,version,paused,opt_out,last_event_at")
      .eq("organization_id", scope.organizationId)
      .eq("contact_id", scope.contactId)
      .maybeSingle(),
  ]);
  if (rows.error || session.error) throw new AgentError("storage_unavailable");
  return {
    items: (rows.data ?? []).slice(0, 30),
    session: session.data,
    truncated: (rows.data?.length ?? 0) > 30,
  };
}
