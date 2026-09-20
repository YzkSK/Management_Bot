# モデレーション処分と削除ログの因果順保証

## 目的

同じモデレーション処分で発生した削除ログを、非同期の保存時刻ではなく処分ケース (`caseId`) で関連付ける。Dashboardは処分ログを親、削除ログを子として表示する。

## 方針

`createdAt` やログIDによる到着順は使わない。モデレーション処理がDiscordの削除APIを呼ぶ直前に、削除対象メッセージIDと `caseId` の対応をDBへ短期保存する。Gatewayの削除イベントを受けるlogging機能はその対応を読み、`bulkDelete` ログへ `moderationCaseId` を保存する。

このDBバックドの対応表により、Redis購読やGatewayイベントの到着順・プロセス再起動に依存しない関連付けを行う。削除APIが失敗してログが発生しなかった対応表は有効期限後に削除する。

## データモデル

- `moderation_message_deletion_links` を追加する。`guildId`、`messageId`、`caseId`、`expiresAt` を保持し、guild/messageを一意にする。
- `message/bulkDelete` ログへ任意の `moderationCaseId` を追加する。既存ログと通常の手動一括削除には設定しない。
- 期限切れの対応表は、関連付けの書き込み・読取り時に削除する。ログ自体の保持期間には影響しない。

## 処理フロー

1. moderationのメッセージ処理は、最終的に実行する処分の `caseId` と削除対象IDを対応表へ保存する。
2. Discordの削除APIが成功すると、既存のGateway `messageDeleteBulk` ハンドラが発火する。
3. loggingは削除対象IDから同一 `caseId` を解決し、集約削除ログへ `moderationCaseId` を保存する。関連付け不能なログは従来どおり単独ログとして保存する。
4. ログ一覧APIは `moderationCaseId` を持つ一括削除ログを親の `moderationCase` にネストし、通常の最上位一覧から除外する。削除済み投稿ログの既存の折りたたみも、その一括削除ログの子として維持する。
5. Dashboardは親の処分ログを表示し、配下の一括削除ログと投稿ログを段階的に開閉する。

## エラーと互換性

- 対応表の保存に失敗した場合、削除処理を実行しない。因果保証を欠いた削除だけを実行しないためである。
- 削除APIが失敗した場合、期限切れ対応表は後続の掃除で消える。
- `moderationCaseId` のない既存・手動一括削除ログは従来の表示とページングを維持する。
- `VIEW_LOGS` の機微情報マスキングはネストしたすべての子ログに再帰適用する。

## テスト

- 対応表の保存、caseId解決、期限切れの除外をDBテストで検証する。
- `bulkDelete` がcaseIdを保持するスキーマ・ハンドラテストを追加する。
- 一覧APIで `moderationCase → bulkDelete → message/create` の順にネストされ、各子が最上位に重複しないことを検証する。
- Dashboardで因果グループと二段階の折りたたみ、投稿者・本文・添付、名前解決、権限マスキングを検証する。
