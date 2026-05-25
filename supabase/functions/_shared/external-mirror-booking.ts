export type ExternalMirrorBookingLike = {
  source_channel?: string | null;
  external_source?: string | null;
  external_reservation_id?: string | null;
  sync_status?: string | null;
};

const EXTERNAL_MIRROR_SOURCE_CHANNELS = new Set([
  "salonboard",
  "hotpepper",
  "minimo",
  "rakuten_beauty",
]);

const EXTERNAL_MIRROR_SOURCES = new Set([
  "salonboard",
  "salonboard_email",
  "salonboard_import",
  "salonboard_manual",
  "hotpepper",
  "minimo",
  "rakuten_beauty",
]);

export function isExternalMirrorBooking(booking: ExternalMirrorBookingLike | null | undefined): boolean {
  if (!booking) return false;
  const sourceChannel = String(booking.source_channel ?? "").toLowerCase();
  const externalSource = String(booking.external_source ?? "").toLowerCase();
  if (EXTERNAL_MIRROR_SOURCE_CHANNELS.has(sourceChannel)) return true;
  if (EXTERNAL_MIRROR_SOURCES.has(externalSource)) return true;
  if (externalSource.startsWith("salonboard_")) return true;
  return booking.sync_status === "needs_review" && !!booking.external_reservation_id && (
    sourceChannel === "salonboard" ||
    externalSource.startsWith("salonboard") ||
    EXTERNAL_MIRROR_SOURCES.has(externalSource)
  );
}

export async function logExternalMirrorBlocked(
  supabase: {
    from: (table: string) => {
      insert: (value: Record<string, unknown>) => Promise<{ error?: unknown }>;
    };
  },
  booking: ExternalMirrorBookingLike & { id?: string | null; owner_id?: string | null; location_id?: string | null },
  action: "update" | "cancel" | "resend",
  code: string,
) {
  console.warn(`[salonboard] blocked external mirror booking ${action}`, {
    booking_id: booking?.id ?? null,
    owner_id: booking?.owner_id ?? null,
    location_id: booking?.location_id ?? null,
    source_channel: booking?.source_channel ?? null,
    external_source: booking?.external_source ?? null,
    external_reservation_id: booking?.external_reservation_id ?? null,
  });
  if (!booking?.owner_id) return;
  await supabase.from("sync_logs").insert({
    owner_id: booking.owner_id,
    reservation_id: booking.id ?? null,
    channel: "salonboard",
    level: "warning",
    message: `Blocked external mirror booking ${action}`,
    metadata: {
      code,
      action,
      source_channel: booking.source_channel ?? null,
      external_source: booking.external_source ?? null,
      external_reservation_id: booking.external_reservation_id ?? null,
    },
  });
}
