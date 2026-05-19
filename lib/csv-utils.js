export function parseCsvRows(text) {
    const input = String(text ?? "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        const next = input[i + 1];

        if (inQuotes) {
            if (ch === "\r" && next === "\n") {
                cell += "\n";
                i++;
                continue;
            }
            if (ch === "\r") {
                cell += "\n";
                continue;
            }
            if (ch === '"' && next === '"') {
                cell += '"';
                i++;
                continue;
            }
            if (ch === '"') {
                inQuotes = false;
                continue;
            }
            cell += ch;
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            continue;
        }
        if (ch === ",") {
            row.push(cell);
            cell = "";
            continue;
        }
        if (ch === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }
        if (ch === "\r") {
            continue;
        }
        cell += ch;
    }

    row.push(cell);
    rows.push(row);
    return rows;
}

export function normalizeCsvHeader(value) {
    return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

export function isBlankCsvRow(row) {
    return !Array.isArray(row) || row.every((cell) => !String(cell ?? "").trim());
}
