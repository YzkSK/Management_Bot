export const LEGACY_MAIN_MIGRATION_TAG = "0016_remove_messagedelete_action_type";

export function decideBaseline(input: {
  hasJournal: boolean;
  hasApplicationTables: boolean;
  matchesLegacyMain: boolean;
}): "migrate" | "baseline-and-migrate" {
  if (input.hasJournal || !input.hasApplicationTables) return "migrate";
  if (input.matchesLegacyMain) return "baseline-and-migrate";
  throw new Error(
    "Database has application tables but does not match main migration 0016; refusing to synthesize Drizzle history.",
  );
}
