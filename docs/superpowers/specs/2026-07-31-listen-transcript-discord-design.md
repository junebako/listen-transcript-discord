# LISTEN 文字起こし編集 → Discord 通知拡張機能 設計

## 目的

LISTEN (https://listen.style) の文字起こし編集機能で行った編集内容を、指定した Discord Webhook へ自動通知する Chrome 拡張機能をつくる。

`teacherteacher-jp/hahi-web-browser-extension` が同目的の先行実装だが、番組が固定されており、また LISTEN 側に新設された文字起こしエディタページに対応していない。本拡張は番組非依存の汎用版とする。

## 調査結果

### 文字起こしエディタページ (`/p/{program}/{episode}/transcript_editor`)

- Alpine.js 製。セグメントは `.segment-row[data-segment-index][data-start][data-end]` > `p[x-text]`
- 保存は `PUT /p/{program}/{episode}/transcript_editor/replace_segments`
- ペイロードは全セグメントを丸ごと送る形

```json
{"segments":[{"start":2.26,"end":15.78,"speaker":null,"text":"..."}, ...]}
```

- テキスト編集 / 前後のセグメントと結合 / 分割 / チャプター追加 / 話者設定 / 一括置換 / 直前の変更を元に戻す — すべてこの単一エンドポイントを通る
- 保存は編集確定 (blur) のタイミングでデバウンスして飛ぶ

### エピソードページ (`/p/{program}/{episode}`)

- `.replaceable-content`(id は `t{start}` 形式) が健在で、先行実装の前提がそのまま通用する
- 個別セグメント編集は `POST .../update_body`、一括置換は Livewire の `replace-transcription-form`

## アーキテクチャ

```
manifest.json          MV3 / host_permissions: listen.style と discord.com の webhook
src/page-hook.js       MAIN world, document_start — fetch フック・スナップショット保持・差分算出
src/content.js         ISOLATED world — ページ情報の取得・拡張機能側への橋渡し・トースト
src/diff.js            差分アルゴリズム (純粋関数・依存なし)
src/message.js         Discord embed の組み立て (純粋関数・依存なし)
src/listen-url.js      LISTEN の URL 解析 (純粋関数・依存なし)
src/background.js      service worker — 設定を引いて Discord へ POST
src/settings.js        chrome.storage ラッパ
src/ui.css             popup と options で共有するスタイル
popup.html / popup.js  今見ている番組をワンタッチ登録
options.html / options.js  登録済み一覧の管理
```

スナップショットの保持と差分算出をメインワールド側に置いているのは、初期スナップショットをページの Alpine.js の state から読む必要があるためである。コンテンツスクリプトの分離ワールドからは `window.Alpine` に触れない。

### 検知経路

検知は2系統あるが、出口は1つ。

| 経路 | フック対象 | 差分の作り方 |
|---|---|---|
| エディタページ | `PUT .../replace_segments` | スナップショット vs ペイロードで算出 |
| エピソードページ | `POST .../update_body`、Livewire 一括置換 | ペイロードに before/after 相当が揃っている |

どちらも次の共通形に正規化してから background へ渡す。background 以降は経路を意識しない。

```js
{ programSlug, episodeSlug, episodeTitle, source, changes: [...] }
```

### スナップショット (エディタ経路)

- 初期値: `alpine:initialized` を待って Alpine の state から `segments` を読む。取り逃した場合に備えて `DOMContentLoaded` 後にも再試行する
- 更新: `replace_segments` のレスポンスが 200 のときだけ、送ったペイロードで置き換える。失敗時は据え置きなのでリトライで二重通知にならない
- 初期値を取れないまま保存が起きた場合は、そのペイロードを基準として記録するだけで通知しない

Alpine の state では未設定の話者が `-1`、送信ペイロードでは `null` になるため、両者を `null` に正規化してから比較する。実データ (45 セグメント) で検証したところ、1 箇所だけ編集した保存で差分がちょうど 1 件になり、誤検知は出なかった。

### 番組の識別

URL の `/p/{programSlug}/{episodeSlug}` から取る。`programSlug` が設定に未登録なら何もしない。

### 番組名とエピソードタイトルの取得

通知に載せる番組名とエピソードタイトルはページの DOM から読む。ここには落とし穴がある。

**パンくずのリンク文字列は LISTEN 側で 30 文字ほどに切り詰められている。** 末尾に `..` が付いた短縮形で、CSS ではなくマークアップの時点で切れているため `textContent` を読んでも全文は得られない。

そのため次のようにする。

- エピソードタイトルは `h1` を最優先で読む。エディタページでもエピソードページでも `h1` には全文が入っている。取れなければ `document.title` から前後の定型部分を剥がして組み立て、パンくずは最後の手段に回す
- 番組名は同じ番組へのリンクが複数あるので、**最も長い表記**を採る。切り詰められた候補は自然に落ちる

## 差分アルゴリズム (`src/diff.js`)

入力は `prev: Segment[]` と `next: Segment[]`。`Segment = { start, end, speaker, text }`。

1. `start`-`end` の組をキーにしてマップを作る (小数第2位で正規化)
2. 両方にあるキー → `text` / `speaker` を比較して変更を拾う
3. 片方にしかないキー → 時間帯が重なるもの同士でグループ化し、構造変更として扱う

### 操作種別の判定

| 差分の形 | 種別 |
|---|---|
| キー一致・`text` だけ違う | `edit` |
| キー一致・`speaker` だけ違う | `speaker` |
| prev 2件以上 → next 1件 | `merge` |
| prev 1件 → next 2件以上 | `split` |
| 上記以外 | `other` |

エピソードページの一括置換だけは差分算出を経ず、検索文字列と置換文字列をそのまま `bulk_replace` として組み立てる。時刻に紐づかないので `start` / `end` は `null` になる。

「1 回の保存で複数件が変わった」ことは `changes` の件数で表せるので、差分算出側に一括編集用の種別は設けない。通知文言の出し分けはメッセージ組み立て側が担当する。

出力:

```js
{ kind, start, end, before, after }
```

LISTEN の実データではセグメント間にわずかな隙間がある (例: 15.78 で終わり 16.76 で始まる) ため、結合前の 2 件は時間的に連続していない。グループ化は「隣接」ではなく「重なりを辿って伸ばす」方式にしてある。

### ガード

`changes` が空なら何も送らない。デバウンス保存やリトライで同じペイロードが2回飛んでも無害。

### 未確定事項

チャプター追加が `segments` のどのフィールドに乗るかは未確認。乗っていなければ `other` に落ちるだけなので、まず動かしてから詰める。

## Discord への送信フォーマット

1 保存 = 1 メッセージ。Embed 形式。

```js
{
  username: "文字起こし編集",
  embeds: [{
    author: { name: "<番組名>" },
    title:  "<エピソードタイトル>",
    url:    "https://listen.style/p/{program}/{episode}",
    color:  0x5865F2,
    description: "<要約 + 変更ごとのブロック>",
    footer: { text: "文字起こしエディタ" },
    timestamp: "..."
  }]
}
```

Discord 上の投稿者名は「文字起こし編集」で固定する。チャンネルに並んだときに何の通知かがひと目で分かるほうが、投稿者名を編集者名にするより読みやすい。誰が編集したかは要約の頭に置く。表示名が空なら名前を付けずに要約だけ出す。

description は要約行に続けて、変更ごとのブロックを空行区切りで並べる。

<pre>
junebokuが 2 件を変更しました

[00:03:32 編集](https://listen.style/p/foo/bar?t=212)
```diff
- 変更前のテキスト
+ 変更後のテキスト
```
</pre>

embed の field ではなく description に集約しているのは、**field の見出しにはマークダウンが効かない**ためである。見出しをそのまま再生位置へのリンクにすれば、再生用のリンク行を別に持たずに済み、1 変更あたり 1 行短くなる。

時刻に紐づかない一括置換だけは、リンクにせず `**一括置換**` と太字で置く。

### Discord の制約への対処

- `description` は4096文字上限 → 変更は先頭10件まで並べ、予算を超える手前で打ち切る。並べられなかった分は要約に「ほか N 件は省略」と出す
- 1 件が長すぎて他を押し出さないよう、変更前後それぞれ400文字で `…` に切り詰める
- 結合/分割は `before` に元の2件を、`after` に結合後を並べる (分割は逆)

## 設定とデータ

`chrome.storage.sync` に次の形で持つ。

```js
{
  displayName: "...",
  enabled: true,
  programs: {
    "<programSlug>": { label: "<番組名>", webhookUrl: "https://discord.com/api/webhooks/..." }
  }
}
```

`sync` を使うので設定は Chrome 間で同期される。`local` へ切り替えたくなった場合は `src/settings.js` の1箇所で変えられるようにしておく。

### popup — 今見ている番組をさっと登録する用

- 現在のタブ URL から `programSlug` を判定
- 未登録: Webhook URL の入力欄 + 「この番組を登録」
- 登録済み: 「✓ 登録済み」と通知先の表示、解除ボタン
- 通知 ON/OFF トグル、表示名の入力
- LISTEN 以外のページ: options へのリンクだけ

### options — 全体管理用

- 表示名 / 登録済み番組の一覧 (追加・編集・削除)
- 行ごとに「テスト送信」ボタン

## エラー処理

- 番組が未登録 / 通知 OFF → 静かに何もしない (ログのみ)
- 送信失敗 → ページ内トーストを赤で表示 + console にエラー
- 429 → `retry_after` を読んで1回だけリトライ、それでも駄目なら失敗扱い
- 送信成功 → 右下にトースト

## テスト

- `src/diff.js` を `node:test` で単体テストする。TDD で書く
- ケース: 編集 / 複数件の編集 / 話者変更 / 結合 / 分割 / 一括置換 / 変更なし / 実データ形状の結合と分割
- テスト fixture のテキストは `foo` / `bar` などの generic な文字列を使う
- E2E は手動。実際のエディタで各操作をして Discord に届くか確認する
