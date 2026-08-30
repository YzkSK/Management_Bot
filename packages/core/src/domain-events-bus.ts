import { randomUUID } from "node:crypto";
import { DOMAIN_EVENT_SCHEMAS, type DomainEvent, type DomainEventType } from "@management-bot/shared";
import { Redis } from "ioredis";

const STREAM_PREFIX = "domain-events:";
const BLOCK_MS = 1000;
const DEFAULT_MIN_IDLE_MS_FOR_CLAIM = 30_000;
const CLAIM_COUNT = 10;

type EventHandler<T extends DomainEventType> = (event: Extract<DomainEvent, { type: T }>) => void | Promise<void>;

type StreamEntry = [id: string, fields: string[]];
type XReadGroupResponse = [stream: string, entries: StreamEntry[]][];

function isStreamEntry(value: unknown): value is StreamEntry {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [id, fields] = value as unknown[];
  return typeof id === "string" && Array.isArray(fields) && fields.every((f): f is string => typeof f === "string");
}

function parseXReadGroupResponse(raw: unknown): XReadGroupResponse {
  if (!Array.isArray(raw)) return [];
  const result: XReadGroupResponse = [];
  for (const streamResult of raw as unknown[]) {
    if (!Array.isArray(streamResult) || streamResult.length !== 2) continue;
    const [stream, entries] = streamResult as unknown[];
    if (typeof stream !== "string" || !Array.isArray(entries)) continue;
    const parsedEntries = (entries as unknown[]).filter(isStreamEntry);
    result.push([stream, parsedEntries]);
  }
  return result;
}

// XAUTOCLAIMは [cursor, entries, deletedIds] を返す。
function parseXAutoClaimResponse(raw: unknown): StreamEntry[] {
  if (!Array.isArray(raw) || raw.length !== 3) return [];
  const entries = (raw as unknown[])[1];
  if (!Array.isArray(entries)) return [];
  return (entries as unknown[]).filter(isStreamEntry);
}

/**
 * Redis Streamsの薄いヘルパー。機能パッケージ間の連携はdirect importではなく
 * domain-events.tsのイベント型を使ったこの経路で疎結合に行う。
 * consumer group経由のat-least-once配送: handlerが全て成功した場合のみXACKし、
 * 失敗時はPELに残して次回(このプロセスの再起動後含む)XAUTOCLAIMで再配送する。
 *
 * consumerGroupは利用機能ごとに一意な名前を渡すこと(例: "activity")。
 * 同じstreamを複数機能が購読する場合、Streamsの仕様上group単位で独立して
 * 配送されるため、機能ごとに別groupを持たないと同じイベントを取り合ってしまう。
 *
 * ponytail: XTRIMによるストリーム肥大化対策は未実装(閾値要件が未確定のため)。
 * 運用で問題化したらXTRIM MAXLEN ~ <N>を publish 時に追加する。
 *
 * ponytail: type毎に同一subscriber接続上でXREADGROUP BLOCKを直列実行するため、
 * 1インスタンスが多数のtypeを購読するとBLOCK待機が後続typeの応答を遅らせる。
 * 購読type数が増えて問題化したらtype毎に専用接続を持つか、1回のXREADGROUPで
 * 複数streamをまとめて読む構成に変更する。
 */
export class DomainEventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly consumerName: string;
  private readonly handlers = new Map<DomainEventType, Set<EventHandler<DomainEventType>>>();
  private readonly consumerLoops = new Map<DomainEventType, Promise<void>>();
  private closing = false;

  constructor(
    redisUrl: string,
    private readonly consumerGroup: string,
    private readonly onError: (error: unknown, context: { channel: string }) => void = (error, context) =>
      console.error(`DomainEventBus error on ${context.channel}:`, error),
    private readonly minIdleMsForClaim: number = DEFAULT_MIN_IDLE_MS_FOR_CLAIM,
  ) {
    this.consumerName = randomUUID();
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }

  async publish<T extends DomainEventType>(event: Extract<DomainEvent, { type: T }>): Promise<void> {
    const schema = DOMAIN_EVENT_SCHEMAS[event.type];
    const parsed = schema.parse(event);
    await this.publisher.xadd(STREAM_PREFIX + event.type, "*", "payload", JSON.stringify(parsed));
  }

  async subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): Promise<void> {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as unknown as EventHandler<DomainEventType>);

    if (!this.consumerLoops.has(type)) {
      const stream = STREAM_PREFIX + type;
      try {
        // "0": group作成以前に発行済みのイベントも取りこぼさず処理する。
        await this.subscriber.xgroup("CREATE", stream, this.consumerGroup, "0", "MKSTREAM");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
      }
      this.consumerLoops.set(type, this.runConsumerLoop(type));
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    // BLOCK中のXREADGROUPはquit()の正常終了を待つため即応答しない。disconnect()で即座に切る。
    this.subscriber.disconnect();
    await Promise.all(this.consumerLoops.values());
    await this.publisher.quit();
  }

  private async runConsumerLoop(type: DomainEventType): Promise<void> {
    const stream = STREAM_PREFIX + type;
    while (!this.closing) {
      try {
        // 起動時・定期的に他consumerが未ACKのまま放置したエントリを回収する。
        const reclaimed = await this.reclaimPending(stream);
        if (reclaimed.length > 0) {
          await this.processEntries(type, stream, reclaimed);
          continue;
        }

        const raw = await this.subscriber.xreadgroup(
          "GROUP",
          this.consumerGroup,
          this.consumerName,
          "COUNT",
          10,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          stream,
          ">",
        );
        const response = parseXReadGroupResponse(raw);
        const entries = response[0]?.[1] ?? [];
        if (entries.length > 0) await this.processEntries(type, stream, entries);
      } catch (error) {
        if (this.closing) return;
        this.onError(error, { channel: stream });
        await new Promise((r) => setTimeout(r, BLOCK_MS));
      }
    }
  }

  private async reclaimPending(stream: string): Promise<StreamEntry[]> {
    const raw = await this.subscriber.xautoclaim(
      stream,
      this.consumerGroup,
      this.consumerName,
      this.minIdleMsForClaim,
      "0-0",
      "COUNT",
      CLAIM_COUNT,
    );
    return parseXAutoClaimResponse(raw);
  }

  private async processEntries(type: DomainEventType, stream: string, entries: StreamEntry[]): Promise<void> {
    for (const [id, fields] of entries) {
      await this.handleEntry(type, stream, id, fields);
    }
  }

  private async handleEntry(type: DomainEventType, stream: string, id: string, fields: string[]): Promise<void> {
    const payloadIndex = fields.indexOf("payload");
    const raw = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;

    const schema = DOMAIN_EVENT_SCHEMAS[type];
    let payload: unknown;
    try {
      payload = raw === undefined ? undefined : JSON.parse(raw);
    } catch (error) {
      this.onError(error, { channel: stream });
      await this.subscriber.xack(stream, this.consumerGroup, id);
      return;
    }

    const result = schema.safeParse(payload);
    if (!result.success) {
      this.onError(result.error, { channel: stream });
      await this.subscriber.xack(stream, this.consumerGroup, id);
      return;
    }

    const handlers = this.handlers.get(type) ?? [];
    const outcomes = await Promise.allSettled([...handlers].map((handler) => handler(result.data as DomainEvent)));
    const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    for (const failure of failures) {
      this.onError(failure.reason, { channel: stream });
    }
    // 1つでも失敗したらXACKしない。PELに残り、次回このconsumer(または再起動後の
    // 別consumer)がXAUTOCLAIMで回収し再実行する。handler側は再実行を前提に冪等に実装すること。
    if (failures.length > 0) return;

    await this.subscriber.xack(stream, this.consumerGroup, id);
  }
}
