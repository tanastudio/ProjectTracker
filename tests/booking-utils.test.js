import { describe, expect, it } from "vitest";
import {
    bookingMapKey,
    formatDateKeyInTimezone,
    formatSlotDateTime,
    formatSlotTime,
    formatSlotTimeInTimezone,
    formatTimezoneLabel,
    getTodayKey,
    isBookingField,
    normalizeTimeText,
} from "../lib/booking-utils.js";

describe("isBookingField", () => {
    it("detects booking and schedule fields by key or label", () => {
        expect(isBookingField({ key: "cbi_booking", label: "CBI" })).toBe(true);
        expect(isBookingField({ key: "interview", label: "Interview Schedule" })).toBe(true);
        expect(isBookingField({ key: "hogan_status", label: "Hogan Status" })).toBe(false);
    });
});

describe("bookingMapKey", () => {
    it("builds a stable composite key", () => {
        expect(bookingMapKey("record", "field")).toBe("record::field");
    });
});

describe("date and time helpers", () => {
    it("formats local date keys and times", () => {
        expect(getTodayKey(new Date(2026, 4, 11))).toBe("2026-05-11");
        expect(normalizeTimeText("9:00:00")).toBe("09:00");
        expect(formatSlotTime({ start_time: "09:00:00", end_time: "10:30:00" })).toBe("09:00 - 10:30");
    });

    it("formats a slot date and time", () => {
        expect(formatSlotDateTime({ slot_date: "2026-05-21", start_time: "11:30", end_time: "12:00" }, "en-US"))
            .toBe("Thu, May 21, 2026, 11:30 - 12:00");
    });

    it("formats timezone labels and converted slot times", () => {
        const slot = { slot_date: "2026-05-21", start_time: "09:00", end_time: "10:00", timezone: "Asia/Bangkok" };
        expect(formatTimezoneLabel("Asia/Dubai", new Date(Date.UTC(2026, 4, 21, 9, 52)))).toBe("Dubai Time (13:52)");
        expect(formatDateKeyInTimezone(slot, "Asia/Dubai")).toBe("2026-05-21");
        expect(formatSlotTimeInTimezone(slot, "Asia/Dubai")).toBe("06:00 - 07:00");
    });
});
