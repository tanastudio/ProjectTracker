export function isBookingField(field) {
    const key = String(field?.key || "").toLowerCase();
    const label = String(field?.label || "").toLowerCase();
    return key.includes("booking") || key.includes("schedule") || label.includes("booking") || label.includes("schedule");
}

export function bookingMapKey(recordId, fieldId) {
    return `${String(recordId || "")}::${String(fieldId || "")}`;
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
    return end ? `${start}-${end}` : start;
}

export function formatSlotDateTime(slot, locale = "en-US") {
    if (!slot) return "";
    const date = formatDateKey(slot.slot_date, locale);
    const time = formatSlotTime(slot);
    return [date, time].filter(Boolean).join(", ");
}

export function getBookingSlot(booking) {
    return booking?.project_availability_slots || booking?.slot || booking?.slot_data || null;
}

export function formatBookingDateTime(booking, locale = "en-US") {
    const slot = getBookingSlot(booking);
    if (slot) return formatSlotDateTime(slot, locale);
    if (booking?.booked_at) {
        const parsed = new Date(booking.booked_at);
        if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString(locale);
    }
    return "";
}
