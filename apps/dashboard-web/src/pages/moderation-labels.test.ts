import { expect, test } from "bun:test";
import { isPresetIndependentViolationType } from "./moderation-labels.js";

test("NGワードと招待リンクだけは種別ごとの強度選択が不要", () => {
  expect(isPresetIndependentViolationType("ngword")).toBe(true);
  expect(isPresetIndependentViolationType("invite_link")).toBe(true);
  expect(isPresetIndependentViolationType("flood")).toBe(false);
  expect(isPresetIndependentViolationType("raid")).toBe(false);
});
