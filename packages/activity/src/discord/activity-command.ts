import type { FeatureModuleContext } from "@management-bot/core";
import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type Client,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { getMemberDetail, type MemberDetail } from "../application/index.js";
import { type ActivityMeReply, buildActivityMeReply } from "../domain/index.js";

const DAY_MS = 86_400_000;
/** ログカード(logging の ACCENT_COLORS.neutral / negative)と同じ色。機能パッケージ間はimportしないため複製。 */
const NEUTRAL_ACCENT = 0x80848e;
const ERROR_ACCENT = 0xf23f42;

export const ACTIVITY_COMMAND: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  name: "activity",
  description: "アクティビティを確認する",
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "me",
      description: "自分のアクティビティ(本人にだけ表示)",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "period",
          description: "期間",
          choices: [
            { name: "7日", value: "7" },
            { name: "30日", value: "30" },
          ],
        },
      ],
    },
  ],
};

export function parsePeriodDays(value: string | null): 7 | 30 {
  return value === "30" ? 30 : 7;
}

/** ログメッセージと同じComponents V2カード(見出し → 区切り線 → 日別 → 集計時刻)を作る。 */
export function buildActivityMeContainer(reply: ActivityMeReply, now: Date): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(NEUTRAL_ACCENT)
    .addTextDisplayComponents((text) => text.setContent(`### ${reply.title}\n${reply.summary}`));
  if (reply.daily) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) => text.setContent(`-# 日別\n${reply.daily}`));
  }
  return container
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((text) => text.setContent(`-# <t:${Math.floor(now.getTime() / 1000)}:f> 時点`));
}

function buildErrorContainer(message: string): ContainerBuilder {
  return new ContainerBuilder().setAccentColor(ERROR_ACCENT).addTextDisplayComponents((text) => text.setContent(message));
}

export async function buildActivityMeResponse(
  input: { guildId: string; userId: string; periodDays: number; now: Date },
  getDetail: (query: { guildId: string; userId: string; from: Date; to: Date }) => Promise<MemberDetail>,
): Promise<ContainerBuilder> {
  const detail = await getDetail({
    guildId: input.guildId,
    userId: input.userId,
    from: new Date(input.now.getTime() - input.periodDays * DAY_MS),
    to: input.now,
  });
  return buildActivityMeContainer(buildActivityMeReply(detail, input.periodDays), input.now);
}

async function handleActivityMe(ctx: FeatureModuleContext, interaction: ChatInputCommandInteraction<"cached" | "raw">): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const container = await buildActivityMeResponse(
      {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        periodDays: parsePeriodDays(interaction.options.getString("period")),
        now: new Date(),
      },
      (query) => getMemberDetail(ctx.db, query),
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    console.error("activity: failed to handle /activity me", error);
    await interaction.editReply({
      components: [buildErrorContainer("アクティビティの取得に失敗しました。時間をおいて再度お試しください。")],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

/**
 * `/activity` をグローバルコマンドとして登録し、`me` を処理する。
 * commands.createは同名コマンドを上書きするため再起動で重複せず、他機能のコマンドも消さない(setは使わない)。
 */
export function registerActivityCommand(ctx: FeatureModuleContext): void {
  const register = (client: Client<true>) => {
    void client.application.commands.create(ACTIVITY_COMMAND).catch((error: unknown) => {
      console.error("activity: failed to register /activity command", error);
    });
  };
  if (ctx.client.isReady()) register(ctx.client);
  else ctx.client.once("ready", register);

  ctx.client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== ACTIVITY_COMMAND.name) return;
    if (!interaction.inGuild() || interaction.options.getSubcommand() !== "me") return;
    void handleActivityMe(ctx, interaction).catch((error: unknown) => {
      console.error("activity: failed to reply to /activity me", error);
    });
  });
}
