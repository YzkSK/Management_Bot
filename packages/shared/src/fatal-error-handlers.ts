// 未処理の例外・rejectionはログを残して終了し、コンテナのrestartポリシーで再起動させる(issue #558)。
// 不定状態のまま動き続けるよりクリーンに再起動するほうが安全なため、全appでこの方針に統一する。
export const installFatalErrorHandlers = (appName: string): void => {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${appName}] unhandledRejection, exiting:`, reason);
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    console.error(`[${appName}] uncaughtException, exiting:`, error);
    process.exit(1);
  });
};
