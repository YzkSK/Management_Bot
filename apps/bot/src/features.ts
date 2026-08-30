import type { FeatureModule } from "@management-bot/core";
import { activityFeatureModule } from "@management-bot/activity";
import { loggingFeatureModule } from "@management-bot/logging";
import { tempVoiceFeatureModule } from "@management-bot/temp-voice";
import { moderationFeatureModule } from "@management-bot/moderation";

/**
 * 機能配線点。新機能追加時はここに1行importして配列に追記するだけでよい
 * (新機能追加チェックリスト参照)。
 */
export const FEATURES: FeatureModule[] = [
  activityFeatureModule,
  loggingFeatureModule,
  tempVoiceFeatureModule,
  moderationFeatureModule,
];
