import assert from "node:assert/strict";
import test from "node:test";
import { extractReserveId, parseCompactClock, parseTimeRangeAndDuration } from "./listDayReservations.js";

test("accepts numeric SalonBoard reservation ids and rejects configuration ids", () => {
  assert.equal(extractReserveId("reserve_item_BF01374917"), "BF01374917");
  assert.equal(extractReserveId("reserveId=BF01181179"), "BF01181179");
  assert.equal(extractReserveId("BFRTYPEDISPFREETOP"), null);
  assert.equal(extractReserveId("bfrTypeDispAssistant"), null);
});

test("normalizes panel clock and detail duration", () => {
  assert.equal(parseCompactClock("1400"), "14:00");
  assert.deepEqual(parseTimeRangeAndDuration("2026年5月26日 14:00〜16:30 施術時間 02:30"), {
    start: "14:00",
    end: "16:30",
    duration: 150,
  });
});
