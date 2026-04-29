const DEFAULT_TIMEOUT_MS = 2600;
const TOAST_ROOT_ID = "toastNotificationRoot";

function getToastRoot() {
  let root = document.getElementById(TOAST_ROOT_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = TOAST_ROOT_ID;
  root.className = "toast-notification-root";
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "false");
  document.body.appendChild(root);
  return root;
}

export function showToast(message, isError = false, options = {}) {
  const text = String(message ?? "").trim();
  if (!text) return null;

  const root = getToastRoot();
  const toast = document.createElement("div");
  toast.className = "toast-notification " + (isError ? "toast-notification-error" : "toast-notification-ok");
  toast.setAttribute("role", isError ? "alert" : "status");
  toast.textContent = text;
  root.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 180);
  }, timeoutMs);

  return toast;
}

export function clearToasts() {
  const root = document.getElementById(TOAST_ROOT_ID);
  if (!root) return;
  root.replaceChildren();
}
