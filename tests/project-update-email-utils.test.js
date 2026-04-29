import { describe, expect, it } from "vitest";
import {
    describeProjectUpdateSchedule,
    normalizeMonthDays,
    normalizeProjectUpdateSchedule,
    normalizeWeekdays,
    validateProjectUpdateSchedule,
} from "../lib/project-update-email-utils.js";

describe("normalizeWeekdays", () => {
    it("keeps only ISO weekdays and sorts them", () => {
        expect(normalizeWeekdays([5, "1", 9, 3, 3, 0])).toEqual([1, 3, 5]);
    });
});

describe("normalizeMonthDays", () => {
    it("keeps only valid days and caps the list at two values", () => {
        expect(normalizeMonthDays([15, "1", 40, 15, 28, 0])).toEqual([1, 15]);
    });
});

describe("normalizeProjectUpdateSchedule", () => {
    it("normalizes a weekly schedule", () => {
        expect(normalizeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "weekly",
            weekly_days: [5, "1", 5],
            monthly_days: [1, 15],
            send_hour: 25,
            send_minute: 72,
        })).toEqual({
            is_enabled: true,
            schedule_type: "weekly",
            weekly_days: [1, 5],
            monthly_days: [],
            monthly_mode: "dates",
            send_hour: 23,
            send_minute: 59,
            timezone: "Asia/Bangkok",
        });
    });

    it("normalizes a monthly schedule", () => {
        expect(normalizeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "monthly",
            weekly_days: [1, 2],
            monthly_days: [15, "1", 40],
            send_hour: -2,
            send_minute: -5,
            timezone: "UTC",
        })).toEqual({
            is_enabled: true,
            schedule_type: "monthly",
            weekly_days: [],
            monthly_days: [1, 15],
            monthly_mode: "dates",
            send_hour: 0,
            send_minute: 0,
            timezone: "UTC",
        });
    });

    it("supports end-of-month schedules", () => {
        expect(normalizeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "monthly",
            monthly_mode: "end_of_month",
            monthly_days: [1, 15],
        })).toEqual({
            is_enabled: true,
            schedule_type: "monthly",
            weekly_days: [],
            monthly_days: [],
            monthly_mode: "end_of_month",
            send_hour: 9,
            send_minute: 0,
            timezone: "Asia/Bangkok",
        });
    });
});

describe("validateProjectUpdateSchedule", () => {
    it("rejects an empty weekly schedule", () => {
        expect(validateProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "weekly",
            weekly_days: [],
        })).toEqual({
            ok: false,
            message: "Select at least one weekday.",
        });
    });

    it("rejects an empty monthly schedule", () => {
        expect(validateProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "monthly",
            monthly_days: [],
        })).toEqual({
            ok: false,
            message: "Select at least one monthly send date.",
        });
    });
});

describe("describeProjectUpdateSchedule", () => {
    it("describes weekly schedules", () => {
        expect(describeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "weekly",
            weekly_days: [1, 3, 5],
            send_hour: 14,
            send_minute: 30,
        })).toBe("Weekly on Mon, Wed, and Fri at 14:30");
    });

    it("describes monthly schedules", () => {
        expect(describeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "monthly",
            monthly_days: [1, 15],
            send_hour: 8,
            send_minute: 15,
        })).toBe("Monthly on 1st and 15th at 08:15");
    });

    it("describes end-of-month schedules", () => {
        expect(describeProjectUpdateSchedule({
            is_enabled: true,
            schedule_type: "monthly",
            monthly_mode: "end_of_month",
            send_hour: 18,
            send_minute: 0,
        })).toBe("Monthly on the last day at 18:00");
    });

    it("returns Disabled when the schedule is off", () => {
        expect(describeProjectUpdateSchedule({
            is_enabled: false,
            schedule_type: "weekly",
            weekly_days: [1],
        })).toBe("Disabled");
    });
});
