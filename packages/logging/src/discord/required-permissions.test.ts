import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import { LOGGING_REQUIRED_PERMISSIONS } from "./required-permissions.js";

describe("LOGGING_REQUIRED_PERMISSIONS", () => {
  test("View Audit Log権限を指す(integration/監査ログ相関がguildAuditLogEntryCreateに依存するため)", () => {
    expect(LOGGING_REQUIRED_PERMISSIONS).toBe(PermissionFlagsBits.ViewAuditLog);
  });
});
