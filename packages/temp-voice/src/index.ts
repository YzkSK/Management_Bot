export { tempVoiceFeatureModule } from "./feature-module.js";
export { tempVoiceRouter, type ActiveTempVoiceChannel } from "./router/index.js";
// appRouter(apps/dashboard-api)がtempVoiceRouterの戻り値型を推論する際に必要(TS2883対策)。
export type { ActiveTempVoiceChannelRow, TempVoiceConfig } from "./application/index.js";
