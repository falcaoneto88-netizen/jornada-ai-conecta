import { z } from "zod";
import type { DraftPayload, DraftRow, ManualConversation, QueueError, Settings } from "./core";

export const queueCategorySchema = z.enum(["review", "team", "uncertain", "history"]);
export type QueueCategory = z.infer<typeof queueCategorySchema>;
const pageFields = {
  query: z.string().trim().max(100).default(""),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
  asOf: z.string().datetime({ offset: true }).optional(),
};
export const queuePageSchema = z
  .object({
    organizationId: z.string().uuid(),
    category: queueCategorySchema.default("review"),
    ...pageFields,
  })
  .strict();
export const manualQueueSchema = queuePageSchema.omit({ category: true });
export type AgentQueueRequest = z.infer<typeof queuePageSchema>;
export type QueuePageRequest = Omit<AgentQueueRequest, "organizationId">;
export type ManualQueueRequest = Omit<z.infer<typeof manualQueueSchema>, "organizationId">;
export type QueueCounts = Record<QueueCategory, number>;
export type QueuePagination = QueuePageRequest & {
  asOf: string;
  total: number;
  totalPages: number;
  hasMore: boolean;
};
export type AgentQueueItem = Omit<DraftRow, "payload"> & {
  content: DraftPayload | null;
  contactName: string | null;
  channel: string | null;
  category: QueueCategory;
  policyCurrent: boolean;
};
export type AgentQueuePage = {
  settings: Settings;
  enabled: boolean;
  sendEnabled: boolean;
  items: AgentQueueItem[];
  /** Only failed ingestion events; ignored/superseded events are not failures. */
  errors: QueueError[];
  failedEventCount: number;
  ignoredEventCount: number;
  counts: QueueCounts;
  pagination: QueuePagination;
};
export type ManualQueueConversation = ManualConversation & {
  contactName: string | null;
  channel: string | null;
};
export type ManualQueuePage = ManualQueueRequest & {
  asOf: string;
  items: ManualQueueConversation[];
  total: number;
  totalPages: number;
  hasMore: boolean;
};
