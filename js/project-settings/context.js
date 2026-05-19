import { supabase } from "../../supabaseClient.js";
import { SUPABASE_URL } from "../config.js";
import { showToast } from "../../lib/toast-notifications.js";
import {
  describeProjectUpdateSchedule,
  normalizeMonthDays,
  normalizeProjectUpdateSchedule,
  normalizeWeekdays,
  validateProjectUpdateSchedule,
} from "../../lib/project-update-email-utils.js";
import {
  BOOKING_TIMEZONES,
  formatDateKeyInTimezone,
  formatSlotDateTime,
  formatSlotTimeInTimezone,
  formatTimezoneLabel,
  getDateKeyForTimezone,
  getDefaultBookingTimezone,
  getTodayKey,
  isAvailabilitySlotBookable,
  isAvailabilitySlotInFuture,
  isBookingField,
  normalizeMinimumNoticeHours,
  normalizeTimeText,
} from "../../lib/booking-utils.js";

export function createProjectSettingsContext() {
  const el = (id) => document.getElementById(id);
  const pageSkeleton = el("pageSkeleton");
  const params = new URLSearchParams(location.search);
  const PROJECT_ID = params.get("project") || sessionStorage.getItem("selected_project_id") || "";

  if (!PROJECT_ID) {
    window.location.replace("./projects.html");
    throw new Error("no project");
  }
  sessionStorage.setItem("selected_project_id", PROJECT_ID);
  if (!params.get("project")) {
    const url = new URL(window.location.href);
    url.searchParams.set("project", PROJECT_ID);
    history.replaceState(null, "", url.toString());
  }

  function hidePageSkeleton() {
    if (pageSkeleton) pageSkeleton.hidden = true;
    document.body.classList.remove("is-page-loading");
  }

  function showHint(text, isErr = false) {
    const h = el("hint");
    if (h) {
      h.className = "hint";
      h.textContent = "";
    }
    showToast(text, isErr);
  }

  function clearHint() {
    const h = el("hint");
    if (!h) return;
    h.className = "hint";
    h.textContent = "";
  }

  let confirmDialogResolve = null;

  function closeConfirmDialog(result = false) {
    const modal = el("confirmDialog");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (confirmDialogResolve) {
      const resolve = confirmDialogResolve;
      confirmDialogResolve = null;
      resolve(result);
    }
  }

  function showConfirmDialog({
    title = "Confirm Action",
    subtitle = "Review the impact before continuing.",
    message = "",
    confirmText = "Continue",
    cancelText = "Cancel",
  } = {}) {
    const modal = el("confirmDialog");
    if (!modal) return Promise.resolve(false);
    if (confirmDialogResolve) closeConfirmDialog(false);

    el("confirmDialogTitle").textContent = title;
    el("confirmDialogSubtitle").textContent = subtitle;
    el("confirmDialogMessage").textContent = message;
    el("confirmDialogConfirm").textContent = confirmText;
    el("confirmDialogCancel").textContent = cancelText;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => el("confirmDialogConfirm")?.focus(), 0);
    return new Promise((resolve) => {
      confirmDialogResolve = resolve;
    });
  }

  async function getFunctionErrorMessage(error) {
    const fallback = error?.message || String(error || "Unknown error");
    const response = error?.context;
    if (!response || typeof response.clone !== "function") return fallback;

    try {
      const body = await response.clone().json();
      return body?.error || body?.message || fallback;
    } catch {
      try {
        const text = await response.clone().text();
        return text || fallback;
      } catch {
        return fallback;
      }
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function ordinalDayLabel(day) {
    const n = Number(day);
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return String(n) + "th";
    const mod10 = n % 10;
    if (mod10 === 1) return String(n) + "st";
    if (mod10 === 2) return String(n) + "nd";
    if (mod10 === 3) return String(n) + "rd";
    return String(n) + "th";
  }

  return {
    supabase,
    SUPABASE_URL,
    el,
    PROJECT_ID,
    session: null,
    state: {
      currentProfileRole: "viewer",
      fields: [],
      members: [],
    },
    controllers: {},
    hidePageSkeleton,
    showHint,
    clearHint,
    showConfirmDialog,
    closeConfirmDialog,
    getFunctionErrorMessage,
    escapeHtml,
    ordinalDayLabel,
    projectUpdateEmailUtils: {
      describeProjectUpdateSchedule,
      normalizeMonthDays,
      normalizeProjectUpdateSchedule,
      normalizeWeekdays,
      validateProjectUpdateSchedule,
    },
    bookingUtils: {
      BOOKING_TIMEZONES,
      formatDateKeyInTimezone,
      formatSlotDateTime,
      formatSlotTimeInTimezone,
      formatTimezoneLabel,
      getDateKeyForTimezone,
      getDefaultBookingTimezone,
      getTodayKey,
      isAvailabilitySlotBookable,
      isAvailabilitySlotInFuture,
      isBookingField,
      normalizeMinimumNoticeHours,
      normalizeTimeText,
    },
  };
}
