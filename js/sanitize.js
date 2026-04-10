/**
 * Escapes HTML special characters to prevent XSS when inserting
 * untrusted strings into innerHTML or template literals.
 *
 * @param {*} value - Any value (will be coerced to string)
 * @returns {string} - HTML-escaped string safe to use inside HTML
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
