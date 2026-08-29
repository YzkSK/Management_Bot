import { DOMAIN_EVENT_SCHEMAS, type DomainEvent, type DomainEventType } from "@management-bot/shared";
import { Redis } from "ioredis";

const CHANNEL_PREFIX = "domain-events:";

type EventHandler<T extends DomainEventType> = (event: Extract<DomainEvent, { type: T }>) => void | Promise<void>;

/**
 * Redis Pub/Subの薄いヘルパー。機能パッケージ間の連携はdirect importではなく
 * domain-events.tsのイベント型を使ったこの経路で疎結合に行う。
 *
 * 注意: Redis Pub/Subはat-most-once配信。購読前に発行されたイベントや、
 * 購読者がダウンしている間に発行されたイベントは失われる。
 * 欠落が許容できない用途(監査ログ等)にはRedis StreamsやDBのoutbox等を使うこと。
 */
export class DomainEventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<DomainEventType, Set<EventHandler<DomainEventType>>>();
  private readonly subscribing = new Map<DomainEventType, Promise<void>>();

  constructor(
    redisUrl: string,
    private readonly onError: (error: unknown, context: { channel: string }) => void = (error, context) =>
      console.error(`DomainEventBus error on ${context.channel}:`, error),
  ) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.subscriber.on("message", (channel, message) => this.handleMessage(channel, message));
  }

  async publish<T extends DomainEventType>(event: Extract<DomainEvent, { type: T }>): Promise<void> {
    const schema = DOMAIN_EVENT_SCHEMAS[event.type];
    const parsed = schema.parse(event);
    await this.publisher.publish(CHANNEL_PREFIX + event.type, JSON.stringify(parsed));
  }

  async subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): Promise<void> {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as unknown as EventHandler<DomainEventType>);

    let pending = this.subscribing.get(type);
    if (!pending) {
      pending = this.subscriber.subscribe(CHANNEL_PREFIX + type).then(() => undefined);
      this.subscribing.set(type, pending);
    }
    await pending;
  }

  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  private handleMessage(channel: string, message: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const type = channel.slice(CHANNEL_PREFIX.length) as DomainEventType;
    const schema = DOMAIN_EVENT_SCHEMAS[type];
    if (!schema) return;

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch (error) {
      this.onError(error, { channel });
      return;
    }

    const result = schema.safeParse(payload);
    if (!result.success) {
      this.onError(result.error, { channel });
      return;
    }

    for (const handler of this.handlers.get(type) ?? []) {
      void Promise.resolve(handler(result.data as DomainEvent)).catch((error: unknown) =>
        this.onError(error, { channel }),
      );
    }
  }
}
