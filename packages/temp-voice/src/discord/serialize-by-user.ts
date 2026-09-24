/**
 * ユーザーIDごとに非同期処理を直列化するユーティリティ。voiceStateUpdateはリスナー内でawaitせず
 * 発火されるため、同一ユーザーの短時間の連続イベント(例: 退出→即再入室)が並行実行され、
 * 処理順が保証されない問題への対策(#414のhandle-voice-session.ts、#410のhandle-owner-grace.tsで
 * 同じ問題が起きたため共通化した。codexレビュー指摘)。
 */
export function createUserSerializer(): (userId: string, task: () => Promise<void>) => Promise<void> {
  const queueByUserId = new Map<string, Promise<void>>();

  return function runSerialized(userId: string, task: () => Promise<void>): Promise<void> {
    const previous = queueByUserId.get(userId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => {});
    queueByUserId.set(userId, settled);
    // 自分がキューの最後尾のままなら(=このユーザーに後続の呼び出しが来ていなければ)、
    // 完了時にエントリを削除する。voiceStateUpdateが起きる全ユーザー分がプロセス終了まで
    // Mapに残り続けるのを防ぐ。
    settled.then(() => {
      if (queueByUserId.get(userId) === settled) queueByUserId.delete(userId);
    });
    return next;
  };
}
