# 認証・認可フロー

## 目的

Dashboardのログインから、ギルド単位の実効権限を使ったAPI認可までを示す。

```mermaid
sequenceDiagram
  actor User as Dashboard利用者
  participant Web as dashboard-web
  participant API as dashboard-api
  participant Session as dashboard-access/session
  participant Discord as Discord API
  participant DB as PostgreSQL
  participant Access as dashboard-access/effective-capabilities

  User->>Web: ログイン
  Web->>API: OAuth開始
  API->>Discord: OAuth認可・トークン交換
  Discord-->>API: Discord user / access token
  API->>Session: セッション作成
  Session->>DB: sessionsへ保存
  API-->>Web: セッションCookie

  User->>Web: ギルド画面を開く
  Web->>API: tRPC procedure(guildId)
  API->>Session: Cookieからセッション検証
  Session->>DB: sessionsを照会
  API->>Discord: ギルド所属・ロール・所有者を確認
  API->>Access: 実効capabilitiesを解決
  Access->>DB: capability_grantsを照会
  Access-->>API: capabilities

  alt 必要capabilityあり
    API-->>Web: procedureの結果
  else 権限なしまたは非所属
    API-->>Web: FORBIDDEN
  end
```

## 実効権限の規則

```mermaid
flowchart TD
  Start[ギルド操作を要求] --> Member{Discord上で\nギルドに所属?}
  Member -->|いいえ| Deny[FORBIDDEN]
  Member -->|はい| Owner{ギルドオーナー?}
  Owner -->|はい| All[ALL_CAPABILITIES]
  Owner -->|いいえ| Grants[直接付与 + 所属ロール + @everyone\nのcapability_grantsをOR結合]
  All --> Check{必要capabilityを持つ?}
  Grants --> Check
  Check -->|はい| Allow[procedureを実行]
  Check -->|いいえ| Deny
```

## ログ閲覧の追加規則

| 権限 | 許可される内容 |
|---|---|
| `VIEW_LOGS` | ログの要約、現在本文 `content`、整形済み差分。 |
| `VIEW_LOGS_RAW` | 上記に加え、編集前本文 `previousContent` と保存payloadの「生データ」展開欄。 |

