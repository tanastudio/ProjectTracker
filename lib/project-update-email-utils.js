// English comments only

export const PROJECT_UPDATE_SCHEDULE_TYPES = ["weekly", "monthly"];
export const PROJECT_UPDATE_WEEKDAYS = [
    { value: 1, label: "Mon", longLabel: "Monday" },
    { value: 2, label: "Tue", longLabel: "Tuesday" },
    { value: 3, label: "Wed", longLabel: "Wednesday" },
    { value: 4, label: "Thu", longLabel: "Thursday" },
    { value: 5, label: "Fri", longLabel: "Friday" },
    { value: 6, label: "Sat", longLabel: "Saturday" },
    { value: 7, label: "Sun", longLabel: "Sunday" },
];

const WEEKDAY_SET = new Set(PROJECT_UPDATE_WEEKDAYS.map((day) => day.value));

function normalizeClockValue(value, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(0, parsed));
}

export function normalizeWeekdays(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => WEEKDAY_SET.has(value)))]
        .sort((a, b) => a - b);
}

export function normalizeMonthDays(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => value >= 1 && value <= 31))]
        .sort((a, b) => a - b)
        .slice(0, 2);
}

export function normalizeProjectUpdateSchedule(input = {}) {
    const scheduleType = PROJECT_UPDATE_SCHEDULE_TYPES.includes(String(input.schedule_type || "").trim())
        ? String(input.schedule_type).trim()
        : "weekly";
    const monthlyMode = String(input.monthly_mode || "").trim() === "end_of_month"
        ? "end_of_month"
        : "dates";
    const weeklyDays = normalizeWeekdays(input.weekly_days);
    const monthlyDays = normalizeMonthDays(input.monthly_days);
    const sendHour = normalizeClockValue(input.send_hour, 23, 9);
    const sendMinute = normalizeClockValue(input.send_minute, 59, 0);

    return {
        schedule_type: scheduleType,
        is_enabled: Boolean(input.is_enabled),
        weekly_days: scheduleType === "weekly" ? weeklyDays : [],
        monthly_days: scheduleType === "monthly" && monthlyMode !== "end_of_month" ? monthlyDays : [],
        monthly_mode: scheduleType === "monthly" ? monthlyMode : "dates",
        send_hour: sendHour,
        send_minute: sendMinute,
        timezone: String(input.timezone || "Asia/Bangkok").trim() || "Asia/Bangkok",
    };
}

export function validateProjectUpdateSchedule(input = {}) {
    const settings = normalizeProjectUpdateSchedule(input);

    if (!settings.is_enabled) {
        return { ok: true, settings };
    }

    if (settings.schedule_type === "weekly" && settings.weekly_days.length === 0) {
        return { ok: false, message: "Select at least one weekday." };
    }

    if (
        settings.schedule_type === "monthly"
        && settings.monthly_mode !== "end_of_month"
        && settings.monthly_days.length === 0
    ) {
        return { ok: false, message: "Select at least one monthly send date." };
    }

    return { ok: true, settings };
}

function weekdayLabel(value, useLongLabel = false) {
    const match = PROJECT_UPDATE_WEEKDAYS.find((day) => day.value === value);
    return useLongLabel ? match?.longLabel ?? String(value) : match?.label ?? String(value);
}

function ordinal(value) {
    const abs = Math.abs(Number(value));
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
    const mod10 = abs % 10;
    if (mod10 === 1) return `${abs}st`;
    if (mod10 === 2) return `${abs}nd`;
    if (mod10 === 3) return `${abs}rd`;
    return `${abs}th`;
}

function joinList(items) {
    if (items.length <= 1) return items[0] || "";
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatTime(hour, minute) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function describeProjectUpdateSchedule(input = {}, { longWeekday = false } = {}) {
    const settings = normalizeProjectUpdateSchedule(input);

    if (!settings.is_enabled) return "Disabled";

    if (settings.schedule_type === "monthly") {
        if (settings.monthly_mode === "end_of_month") {
            return `Monthly on the last day at ${formatTime(settings.send_hour, settings.send_minute)}`;
        }
        return `Monthly on ${joinList(settings.monthly_days.map(ordinal))} at ${formatTime(settings.send_hour, settings.send_minute)}`;
    }

    return `Weekly on ${joinList(settings.weekly_days.map((day) => weekdayLabel(day, longWeekday)))} at ${formatTime(settings.send_hour, settings.send_minute)}`;
}
