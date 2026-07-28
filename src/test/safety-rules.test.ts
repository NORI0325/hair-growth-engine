import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isExternalMirrorBooking } from "@/lib/external-booking";
import { addDaysToDateKey, dateKeyInJst } from "@/lib/jst-date";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("external mirror booking guard", () => {
  it.each([
    { source_channel: "salonboard" },
    { external_source: "salonboard_email" },
    { external_source: "salonboard_import" },
    { source_channel: "hotpepper" },
  ])("blocks external mirror source %#", (booking) => {
    expect(isExternalMirrorBooking(booking)).toBe(true);
  });

  it.each([
    { source_channel: "line", external_source: "public_form" },
    { source_channel: "own_web", external_source: "booking_token" },
    { source_channel: "manual", external_source: "staff_manual" },
  ])("does not block SalonBoost-origin booking %#", (booking) => {
    expect(isExternalMirrorBooking(booking)).toBe(false);
  });
});

describe("JST date boundaries", () => {
  it("uses the next calendar day after midnight in Japan", () => {
    expect(dateKeyInJst(new Date("2026-05-25T15:30:00.000Z"))).toBe("2026-05-26");
  });

  it("adds calendar days without local timezone drift", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("deployment safety contracts", () => {
  it("does not embed a project-specific JWT in internal invocation code", () => {
    const internalInvoker = source("supabase/functions/_shared/invoke-internal.ts");
    const config = source("supabase/config.toml");
    expect(internalInvoker).not.toContain("LEGACY_ANON_JWT_FALLBACK");
    expect(internalInvoker).toContain('"apikey": SERVICE_ROLE_KEY');
    expect(config).toMatch(/\[functions\.send-transactional-email\][\s\S]*?verify_jwt\s*=\s*false/);
  });

  it("keeps live SalonBoard display and write rules on the same source data", () => {
    const menuRpc = source("supabase/migrations/20260728130000_align_public_bookable_menus_with_salonboard.sql");
    const bookingGuard = source("supabase/migrations/20260728120000_guard_booking_location_and_overlap.sql");
    for (const sql of [menuRpc, bookingGuard]) {
      expect(sql).toContain("cmo.active = true");
      expect(sql).toContain("mcm.rsv_term = cmo.rsv_term");
      expect(sql).toContain("'^SN[0-9]+$'");
    }
    expect(menuRpc).toContain("cmo.rsv_term AS duration_minutes");
    expect(bookingGuard).toContain("NEW.total_duration_minutes := _authoritative_duration");
    expect(bookingGuard).toContain("NEW.total_price := _authoritative_price");
  });

  it("preserves incomplete external mirrors for review instead of rejecting them", () => {
    const bookingGuard = source("supabase/migrations/20260728120000_guard_booking_location_and_overlap.sql");
    expect(bookingGuard).toMatch(/IF _is_external_mirror THEN[\s\S]*?NEW\.needs_manual_review := true;[\s\S]*?RETURN NEW;/);
    expect(bookingGuard).toContain("外部予約の所要時間が未取得です");
  });

  it("requires tenant membership for paginated customer directory access", () => {
    const directory = source("supabase/migrations/20260728110000_add_paginated_customer_directory.sql");
    expect(directory).toContain("public.is_tenant_member(_owner_id, auth.uid())");
    expect(directory).toContain("_safe_limit integer := LEAST");
    expect(directory).toContain("LIMIT _safe_limit OFFSET _safe_offset");
  });

  it("keeps LINE identity unique without rejecting legitimate shared phone numbers", () => {
    const identity = source("supabase/migrations/20260728100000_harden_internal_functions_and_customer_identity.sql");
    expect(identity).toContain("line_user_id_already_linked_for_owner");
    expect(identity).toContain("Phone numbers are intentionally not unique");
    expect(identity).not.toContain("phone_already_registered_for_owner");
  });
});
