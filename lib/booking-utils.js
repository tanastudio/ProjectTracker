export function isBookingField(field) {
    const key = String(field?.key || "").toLowerCase();
    const label = String(field?.label || "").toLowerCase();
    return key.includes("booking") || key.includes("schedule") || label.includes("booking") || label.includes("schedule");
}

export const BOOKING_TIMEZONES = [
    { value: "Asia/Bangkok", label: "Bangkok Time" },
    { value: "Asia/Dubai", label: "Dubai Time" },
    { value: "Asia/Riyadh", label: "Jeddah / KSA Time" },
    { value: "Asia/Singapore", label: "Singapore Time" },
    { value: "Asia/Tokyo", label: "Tokyo Time" },
    { value: "Europe/London", label: "London Time" },
    { value: "Europe/Paris", label: "Paris Time" },
    { value: "America/New_York", label: "New York Time" },
    { value: "America/Los_Angeles", label: "Los Angeles Time" },
    { value: "Australia/Sydney", label: "Sydney Time" },
    { value: "UTC", label: "UTC" },
];

export function bookingMapKey(recordId, fieldId) {
    return `${String(recordId || "")}::${String(fieldId || "")}`;
}

export function isKnownBookingTimezone(timeZone) {
    return BOOKING_TIMEZONES.some((entry) => entry.value === timeZone);
}

export function getDefaultBookingTimezone(fallback = "Asia/Bangkok") {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isKnownBookingTimezone(detected) ? detected : fallback;
}

export function getBookingTimezoneName(timeZone) {
    return BOOKING_TIMEZONES.find((entry) => entry.value === timeZone)?.label || timeZone || "Time zone";
}

export function formatTimezoneLabel(timeZone, date = new Date()) {
    const zone = isKnownBookingTimezone(timeZone) ? timeZone : "Asia/Bangkok";
    const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
    return `${getBookingTimezoneName(zone)} (${time})`;
}

export function getTodayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function normalizeTimeText(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return text;
    return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function getZonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
        minute: Number(parts.minute),
    };
}

export function zonedDateTimeToDate(dateKey, timeText, timeZone = "Asia/Bangkok") {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    const [hour, minute] = normalizeTimeText(timeText).split(":").map(Number);
    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
    let instantUtc = targetUtc;
    for (let i = 0; i < 3; i++) {
        const parts = getZonedParts(new Date(instantUtc), timeZone);
        const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        instantUtc += targetUtc - zonedAsUtc;
    }
    return new Date(instantUtc);
}

export function formatDateKeyInTimezone(slot, targetTimeZone = "Asia/Bangkok") {
    const sourceTimeZone = slot?.timezone || "Asia/Bangkok";
    const startDate = zonedDateTimeToDate(slot?.slot_date, slot?.start_time, sourceTimeZone);
    if (!startDate) return String(slot?.slot_date || "");
    const parts = getZonedParts(startDate, targetTimeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatTimeInTimezone(date, targetTimeZone = "Asia/Bangkok") {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: targetTimeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

export function getDateKeyForTimezone(timeZone = "Asia/Bangkok", date = new Date()) {
    const parts = getZonedParts(date, timeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDateKey(dateKey, locale = "en-US") {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (!year || !month || !day) return String(dateKey || "");
    return new Intl.DateTimeFormat(locale, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(new Date(year, month - 1, day));
}

export function formatSlotTime(slot) {
    const start = normalizeTimeText(slot?.start_time);
    const end = normalizeTimeText(slot?.end_time);
    return end ? `${start} - ${end}` : start;
}

export function formatSlotTimeInTimezone(slot, targetTimeZone = "Asia/Bangkok") {
    const sourceTimeZone = slot?.timezone || "Asia/Bangkok";
    const startDate = zonedDateTimeToDate(slot?.slot_date, slot?.start_time, sourceTimeZone);
    const endDate = slot?.end_time ? zonedDateTimeToDate(slot?.slot_date, slot.end_time, sourceTimeZone) : null;
    const start = formatTimeInTimezone(startDate, targetTimeZone);
    const end = endDate ? formatTimeInTimezone(endDate, targetTimeZone) : "";
    return end ? `${start} - ${end}` : start;
}

export function formatSlotDateTime(slot, locale = "en-US", targetTimeZone = null) {
    if (!slot) return "";
    const dateKey = targetTimeZone ? formatDateKeyInTimezone(slot, targetTimeZone) : slot.slot_date;
    const date = formatDateKey(dateKey, locale);
    const time = targetTimeZone ? formatSlotTimeInTimezone(slot, targetTimeZone) : formatSlotTime(slot);
    return [date, time].filter(Boolean).join(", ");
}

export function getBookingSlot(booking) {
    return booking?.project_availability_slots || booking?.slot || booking?.slot_data || null;
}

export function formatBookingDateTime(booking, locale = "en-US", targetTimeZone = null) {
    const slot = getBookingSlot(booking);
    if (slot) return formatSlotDateTime(slot, locale, targetTimeZone);
    if (booking?.booked_at) {
        const parsed = new Date(booking.booked_at);
        if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString(locale);
    }
    return "";
}
