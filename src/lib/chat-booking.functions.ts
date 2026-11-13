import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  chatBookingOptionsSchema,
  chatBookingCreateSchema,
  chatBookingReadSchema,
} from "./chat-booking.core";

export const getChatBookingOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(chatBookingOptionsSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedChatBooking } = await import("./chat-booking.server");
    const access = await authenticatedChatBooking(context, data);
    return "failure" in access ? access.failure : access.service.options(access.scope, data);
  });
export const createChatBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(chatBookingCreateSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedChatBooking } = await import("./chat-booking.server");
    const access = await authenticatedChatBooking(context, data);
    return "failure" in access ? access.failure : access.service.create(access.scope, data);
  });
export const readChatBookingRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(chatBookingReadSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedChatBooking } = await import("./chat-booking.server");
    const access = await authenticatedChatBooking(context, data);
    return "failure" in access ? access.failure : access.service.read(access.scope, data);
  });

export const abandonChatBookingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(chatBookingReadSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedChatBooking } = await import("./chat-booking.server");
    const access = await authenticatedChatBooking(context, data);
    return "failure" in access ? access.failure : access.service.abandon(access.scope, data);
  });
