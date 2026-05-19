import { describe, expect, it } from "vitest";
import { isBlankCsvRow, normalizeCsvHeader, parseCsvRows } from "../lib/csv-utils.js";

describe("csv-utils", () => {
    it("parses quoted commas and escaped quotes", () => {
        const rows = parseCsvRows('name,email\n"Doe, Jane","jane@example.com"\n"Bob ""B""","bob@example.com"');

        expect(rows).toEqual([
            ["name", "email"],
            ["Doe, Jane", "jane@example.com"],
            ['Bob "B"', "bob@example.com"],
        ]);
    });

    it("keeps line breaks inside quoted cells", () => {
        const rows = parseCsvRows('name,email,note\r\n"Alice","alice@example.com","Line 1\r\nLine 2"');

        expect(rows[1]).toEqual(["Alice", "alice@example.com", "Line 1\nLine 2"]);
    });

    it("normalizes BOM headers and detects blank rows", () => {
        expect(normalizeCsvHeader("\uFEFF Email ")).toBe("email");
        expect(isBlankCsvRow(["", "  ", null])).toBe(true);
        expect(isBlankCsvRow(["", "value"])).toBe(false);
    });
});
