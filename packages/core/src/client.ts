import type { Db } from "@management-bot/db";
import { SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";
import type { DomainEventBus } from "./domain-events-bus.js";
import type { FeatureModule } from "./feature-module.js";

/**
 * discord.jsクライアントの薄いラッパー。SapphireClientを継承するが、
 * 実処理はFEATURESのFeatureModuleに委譲し、discord層自体にビジネスロジックを持たせない。
 *
 * 注意(sapphireのpiece loaderとFEATURES配列の併存について):
 * Sapphireはデフォルトでpiece loader(ファイルシステムからcommands/listenersを自動読込)を持つが、
 * このプロジェクトではFEATURES配列(FeatureModule[])を単一の登録経路として使う。
 * piece loaderのデフォルトディレクトリ探索(./commands, ./listeners等)を無効化しない限り、
 * 同一のコマンド/イベントが両方の経路で二重登録される恐れがある。
 * そのためFeatureModuleを使う機能はpiece loader用ディレクトリにファイルを置かないこと。
 * (将来piece loaderを正式採用する場合はFEATURES経由の登録を廃止し、片方に一本化すること)
 */
export class BotClient extends SapphireClient {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
      loadMessageCommandListeners: false,
    });
  }

  async registerFeatures(
    features: readonly FeatureModule[],
    deps: { db: Db; eventBusFor: (feature: FeatureModule) => DomainEventBus },
  ): Promise<void> {
    const seen = new Set<string>();
    for (const feature of features) {
      if (seen.has(feature.key)) {
        throw new Error(`Duplicate FeatureModule key: ${feature.key}`);
      }
      seen.add(feature.key);
    }

    for (const feature of features) {
      try {
        await feature.registerDiscordHandlers({ client: this, db: deps.db, eventBus: deps.eventBusFor(feature) });
      } catch (error) {
        throw new Error(`Failed to register feature "${feature.key}"`, { cause: error });
      }
    }
  }
}
