export type ExternalMirrorBookingLike = {
  source_channel?: string | null;
  external_source?: string | null;
  external_reservation_id?: string | null;
  sync_status?: string | null;
  needs_manual_review?: boolean | null;
  total_duration_minutes?: number | null;
  menu?: string | null;
  customers?: { full_name?: string | null } | null;
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

export const isExternalMirrorBooking = (booking: ExternalMirrorBookingLike | null | undefined): boolean => {
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
};

export const getExternalMirrorWarnings = (booking: ExternalMirrorBookingLike | null | undefined): string[] => {
  if (!booking) return [];
  const warnings: string[] = [];
  if (isExternalMirrorBooking(booking)) {
    warnings.push("この予約は外部由来のミラー予約です。SalonBoostから変更・キャンセル・再送はできません。必ず元の予約管理画面で確認してください。");
  }
  if (booking.needs_manual_review || booking.sync_status === "needs_review") {
    warnings.push("この予約は取得内容の確認が必要です。メニュー・所要時間・顧客情報を元の予約管理画面で確認してください。");
  }
  if (booking.total_duration_minutes == null) {
    warnings.push("所要時間が取得できていません。空き枠計算や予約表示に影響する可能性があります。");
  }
  const menu = String(booking.menu ?? "");
  const customerName = String(booking.customers?.full_name ?? "");
  if (menu.includes("未取得") || menu.includes("文字化け") || /^予約\s+[A-Z]{1,4}\d+/i.test(customerName)) {
    warnings.push("顧客名またはメニュー名に未取得・文字化けの可能性があります。外部予約の詳細を確認してください。");
  }
  return warnings;
};
