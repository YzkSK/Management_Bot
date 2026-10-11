import type { DomainEventBus } from "@management-bot/core";
import type { ScheduledPostEventRecordedEvent } from "@management-bot/shared";

export type PublishScheduledPostEvent = (event: ScheduledPostEventRecordedEvent) => Promise<void>;

/**
 * logging機能へ渡すイベントを発行する。発行失敗でユーザー操作や投稿処理を失敗させない
 * (ログ欠落はエラーログに残す)。機能間連携はdomain-events経由のみで、loggingを直接importしない。
 */
export function createEventPublisher(eventBus: Pick<DomainEventBus, "publish">): PublishScheduledPostEvent {
  return async (event) => {
    try {
      await eventBus.publish(event);
    } catch (error) {
      console.error(`scheduled-post: failed to publish ${event.action} event for post ${event.postId}`, error);
    }
  };
}
