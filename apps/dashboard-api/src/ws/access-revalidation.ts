/**
 * 接続中のWebSocketの認可を定期的に再検証する。
 * checkは「引き続き許可」ならnull、剥奪済みならcloseコードを返す。
 * 一時的なDiscord API/DBエラー(throw)では切断せず、次回の再検証に委ねる。
 * 戻り値のstopで停止する。
 */
export function startAccessRevalidation(
  check: () => Promise<number | null>,
  close: (code: number, reason: string) => void,
  intervalMs: number,
  onError: (error: unknown) => void = (error) => console.error("ws access revalidation failed", error),
): () => void {
  let stopped = false;
  let running = false;
  const timer = setInterval(() => {
    // 前回の検証が終わっていなければ重ねない。
    if (running) return;
    running = true;
    void check()
      .then((code) => {
        if (stopped || code === null) return;
        stopped = true;
        clearInterval(timer);
        close(code, code === 4001 ? "session expired" : "access revoked");
      })
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
