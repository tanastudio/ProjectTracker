import { describe, expect, it } from "vitest";
import {
    BOOKING_TIMEZONES,
    bookingMapKey,
    formatDateKeyInTimezone,
    formatSlotDateTime,
    formatSlotTime,
    formatSlotTimeInTimezone,
    formatTimezoneLabel,
    getBookingSessionStatusLabel,
    getTodayKey,
    isAvailabilitySlotBookable,
    isAvailabilitySlotInFuture,
    isBookingField,
    normalizeMinimumNoticeHours,
    normalizeTimeText,
} from "../lib/booking-utils.js";

describe("isBookingField", () => {
    it("uses the explicit booking role when present", () => {
        expect(isBookingField({ key: "interview", label: "Interview", field_role: "booking" })).toBe(true);
        expect(isBookingField({ key: "cbi_booking", label: "CBI Booking", field_role: "step" })).toBe(false);
        expect(isBookingField({ key: "hogan_status", label: "Hogan Status", field_role: "step" })).toBe(false);
    });

    it("keeps label and key detection only for legacy fields without a role", () => {
        expect(isBookingField({ key: "cbi_booking", label: "CBI" })).toBe(true);
        expect(isBookingField({ key: "interview", label: "Interview Schedule" })).toBe(true);
    });
});

describe("bookingMapKey", () => {
    it("builds a stable composite key", () => {
        expect(bookingMapKey("record", "field")).toBe("record::field");
    });
});

describe("getBookingSessionStatusLabel", () => {
    it("formats consultant session confirmation status", () => {
        expect(getBookingSessionStatusLabel("completed")).toBe("Completed");
        expect(getBookingSessionStatusLabel("not_completed")).toBe("Not Complete");
        expect(getBookingSessionStatusLabel("pending")).toBe("Pending Confirmation");
        expect(getBookingSessionStatusLabel("")).toBe("Pending Confirmation");
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
        expect(BOOKING_TIMEZONES).toContainEqual({ value: "Asia/Riyadh", label: "Jeddah / KSA Time" });
        expect(formatTimezoneLabel("Asia/Riyadh", new Date(Date.UTC(2026, 4, 21, 9, 52)))).toBe("Jeddah / KSA Time (12:52)");
        expect(formatDateKeyInTimezone(slot, "Asia/Dubai")).toBe("2026-05-21");
        expect(formatSlotTimeInTimezone(slot, "Asia/Dubai")).toBe("06:00 - 07:00");
    });

    it("checks whether an availability slot starts in the future", () => {
        const reference = new Date("2026-05-21T02:00:00.000Z");
        expect(isAvailabilitySlotInFuture({
            slot_date: "2026-05-21",
            start_time: "09:01",
            timezone: "Asia/Bangkok",
        }, reference)).toBe(true);
        expect(isAvailabilitySlotInFuture({
            slot_date: "2026-05-21",
            start_time: "09:00",
            timezone: "Asia/Bangkok",
        }, reference)).toBe(false);
        expect(isAvailabilitySlotInFuture({
            slot_date: "2026-05-21",
            start_time: "08:59",
            timezone: "Asia/Bangkok",
        }, reference)).toBe(false);
    });

    it("checks custom minimum notice hours before booking", () => {
        const reference = new Date("2026-05-21T02:00:00.000Z");
        const slot = {
            slot_date: "2026-05-22",
            start_time: "09:00",
            timezone: "Asia/Bangkok",
        };
        expect(normalizeMinimumNoticeHours("24")).toBe(24);
        expect(normalizeMinimumNoticeHours("-1")).toBe(0);
        expect(normalizeMinimumNoticeHours("9000")).toBe(8760);
        expect(isAvailabilitySlotBookable(slot, 23, reference)).toBe(true);
        expect(isAvailabilitySlotBookable(slot, 24, reference)).toBe(false);
    });
});
