import { describe, expect, it } from "vitest";
import {
    canManageProjectSettings,
    getAdminAccessDecision,
    getFormAccessDecision,
    getProjectSettingsAccessDecision,
    getProjectsAccessDecision,
    resolveCronSecretAccess,
    resolveManualProjectEmailAccess,
} from "../lib/access-control-utils.js";

describe("form access decisions", () => {
    it("allows only admin and internal users into form.html", () => {
        expect(getFormAccessDecision("admin")).toMatchObject({ ok: true, redirectTo: null });
        expect(getFormAccessDecision("internal")).toMatchObject({ ok: true, redirectTo: null });
    });

    it("blocks clients who open form.html directly", () => {
        expect(getFormAccessDecision("client")).toEqual({
            ok: false,
            role: "client",
            redirectTo: "./projects.html",
        });
    });

    it("redirects participants away from form.html", () => {
        expect(getFormAccessDecision("participant")).toEqual({
            ok: false,
            role: "participant",
            redirectTo: "./participant-status.html",
        });
    });
});

describe("admin and project page access decisions", () => {
    it("blocks participants from admin pages", () => {
        expect(getAdminAccessDecision("participant")).toEqual({
            ok: false,
            role: "participant",
            redirectTo: "./projects.html",
        });
    });

    it("blocks participants from the project picker", () => {
        expect(getProjectsAccessDecision("participant")).toEqual({
            ok: false,
            role: "participant",
            redirectTo: "./participant-status.html",
        });
    });

    it("blocks participants from project settings", () => {
        expect(getProjectSettingsAccessDecision({
            profileRole: "participant",
            memberRole: "viewer",
            projectCreatedBy: "owner-1",
            userId: "participant-1",
        })).toEqual({
            ok: false,
            role: "participant",
            redirectTo: "./projects.html",
        });
    });

    it("allows internal project editors to manage project settings", () => {
        expect(canManageProjectSettings({
            profileRole: "internal",
            memberRole: "editor",
            projectCreatedBy: "owner-1",
            userId: "user-1",
        })).toBe(true);
    });
});

describe("manual project update email access", () => {
    it("requires a verified manual user token", () => {
        expect(resolveManualProjectEmailAccess({
            requestedByCron: false,
            manualUserId: "",
            projectId: "project-1",
            canManageProject: true,
        })).toEqual({ ok: false, status: 401, error: "Unauthorized" });
    });

    it("requires a project id for manual sends", () => {
        expect(resolveManualProjectEmailAccess({
            requestedByCron: false,
            manualUserId: "user-1",
            projectId: "",
            canManageProject: true,
        })).toEqual({ ok: false, status: 400, error: "projectId is required for manual sends" });
    });

    it("requires project management permission for manual sends", () => {
        expect(resolveManualProjectEmailAccess({
            requestedByCron: false,
            manualUserId: "user-1",
            projectId: "project-1",
            canManageProject: false,
        })).toEqual({ ok: false, status: 403, error: "Forbidden" });
    });

    it("allows manual sends with a verified user and project permission", () => {
        expect(resolveManualProjectEmailAccess({
            requestedByCron: false,
            manualUserId: "user-1",
            projectId: "project-1",
            canManageProject: true,
        })).toEqual({ ok: true, status: 200, error: null });
    });
});

describe("cron secret fail-closed behavior", () => {
    it("does not run a cron request when the secret is missing", () => {
        expect(resolveCronSecretAccess({
            secret: "",
            header: "",
            source: "cron",
            secretName: "PROJECT_UPDATE_CRON_SECRET",
        })).toEqual({
            requestedByCron: false,
            error: { status: 500, message: "PROJECT_UPDATE_CRON_SECRET is not configured" },
        });
    });

    it("rejects a cron request with the wrong secret", () => {
        expect(resolveCronSecretAccess({
            secret: "expected",
            header: "wrong",
            source: "cron",
            secretName: "BOOKING_FOLLOWUP_CRON_SECRET",
        })).toEqual({
            requestedByCron: false,
            error: { status: 401, message: "Unauthorized" },
        });
    });

    it("allows a cron request only when the configured secret matches the header", () => {
        expect(resolveCronSecretAccess({
            secret: "expected",
            header: "expected",
            source: "cron",
        })).toEqual({ requestedByCron: true, error: null });
    });
});
