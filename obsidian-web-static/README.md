# obsidian-web (静的サイト版)

サーバー(Python等)なしで、**静的ファイルを置くだけ**で動く版です。
Obsidian本体(`obsidian.asar`)を読み込ませ、PC上のフォルダをvaultとして使います。

## ファイル
| ファイル | 役割 |
|---|---|
| `index.html` / `launcher.js` | ランチャー(本体の読み込み・フォルダ選択・起動) |
| `sw.js` | Service Worker(展開済みアプリの配信、vault内の画像などの配信) |
| `app-shim.js` | Electron/Node API(`require`, `fs`, `path` …)のブラウザ代替 |
| `mobile-shim.js` | モバイル版(APK/IPA)用: Capacitorプラグイン(Filesystem など)のブラウザ代替 |
| `prepare.py` | (任意・フォルダ配置用)asar / モバイルzipを解凍し、ファイル一覧 `ow-files.json` を作る |

## Obsidian本体の渡し方(端末ごとに自動で出し分け)
ランチャーは、開いた端末に合わせて**PC → デスクトップ版、スマホ/タブレット → モバイル版**を自動で読み込みます(アップロード操作は不要)。ファイル名は次のとおりに決まっています。

| 端末 | ① フォルダ(**推奨**) | ② 単一ファイル(手軽) |
|---|---|---|
| PC | `obsidian/` | `obsidian.asar` |
| スマホ・タブレット | `obsidian-mobile/` | `obsidian-mobile.zip` |

- 同じ端末向けに①と②の両方がある場合は①を使います。
- 片方の種類しか置いていない場合は、どの端末でもそれを使います(例: zipだけ置くとPCにもモバイル版が出ます)。
- URLに `?ui=mobile` / `?ui=desktop` を付けると、端末に関係なくその種類を読み込み直します。
- `obsidian-mobile.zip` は**APK(Android)とIPA(iOS)のどちらから取り出した `public` フォルダでも**使えます(ランチャーが開いた端末に合わせてAndroid動作/iOS動作を切り替えます)。両方持っている場合は新しい版のほうがおすすめです。zipの中の親フォルダ(`public/` など)はあってもなくてもOKです。

### なぜフォルダ(①)を推奨するか
- 配信が軽い: GitHub Pages などはテキスト(js/css/txt)をgzip圧縮して配信しますが、zipやasarは1つの大きなファイル(約25〜30MB)のまま転送されます。フォルダなら更新が必要なファイルだけ取得できます。
- ブラウザ側の展開処理が要りません(zipの解凍が不要)。
- 一方、フォルダは `prepare.py` で一度ファイル一覧(`ow-files.json`)を作る手間が要ります(静的ホストはフォルダの中身を列挙できないため)。**手軽に試すだけなら②でも十分です。**

```bash
cd obsidian-web-static
python prepare.py obsidian.asar     # → ./obsidian/ と ./obsidian/ow-files.json を作成
python prepare.py public.zip        # → ./obsidian-mobile/ と ./obsidian-mobile/ow-files.json を作成(モバイル版)
# 自分で解凍した場合: python prepare.py --manifest-only ./obsidian   (または ./obsidian-mobile)
```
```
obsidian-web-static/
├── index.html ...
├── obsidian/ または obsidian.asar              ← PC用
└── obsidian-mobile/ または obsidian-mobile.zip  ← スマホ用
```

**手動で選ぶ**: 置いていない場合は、ランチャーの「asar / モバイル版zipを手動で選ぶ」から指定します。

初回アクセス時に自動で読み込み、そのブラウザのCache Storageに保存します。2回目以降は再取得しません。
差し替えたら、ランチャーの「このサイトから読み込み直す」を押してください。
(ブラウザの開発者ツールに、存在しない候補ファイルを探す `404` が少し出ますが、検出のための確認で、問題ありません。)

## 使い方
1. このフォルダを配信する(HTTPSまたは `localhost` が必須。`file://` では動きません)
   ```bash
   cd obsidian-web-static && python3 -m http.server 8800    # → http://localhost:8800/
   ```
   GitHub Pages / Cloudflare Pages / Netlify などにそのまま置いてもOKです(サブパス配信にも対応)。
2. ランチャー(`index.html`)を開く → ①本体は自動読み込み
3. ②「フォルダを選ぶ」でvaultを選ぶ(空フォルダならサンプルノートを作成)
4. ③「開く」

2回目以降は「開く」だけです(ブラウザを閉じた後はフォルダへのアクセス許可を求められます)。

## モバイル版(APK / IPA の `public` フォルダ)について
スマホ版Obsidianの `public` フォルダ(Androidは APK の `assets/public`、iOSは IPA の `Payload/Obsidian.app/public`)を、上の `obsidian-mobile/` または `obsidian-mobile.zip` として置くか、ランチャーで手動で選びます。

- モバイル版はElectronではなくCapacitorで動くため、`mobile-shim.js` がネイティブ側のプラグイン(ファイル操作・端末情報・クリップボード等)をブラウザ上で代わりに実装します。`app.js` は書き換えません。
- ランチャーの「モバイル版zipを読み込んだ場合の動作」で **iOS版 / Android版** を選べます(「自動」は開いている端末で判定: Androidのブラウザ→Android動作、それ以外→iOS動作。ファイル名は見ません。Android/iOSでvault作成画面などの挙動が少し違います)。
- ②で選ぶ場所は **vaultが並ぶ親フォルダ** として使われます(「ブラウザ内お試しvault」ならブラウザ内ストレージ)。vaultの作成・選択はObsidian側の画面で行います。
  - iOS動作: 「Create a vault」でその場所の中にvaultが作られます。
  - Android動作: 「App storage」ならその場所の中に作成。「Device storage」/「Open folder as vault」を選ぶとブラウザのフォルダ選択ダイアログが開きます(Chrome / Edge等のみ)。次回以降は「開く」を押した時にアクセス許可を求められます。
- 制限: ゴミ箱は `<vault>/.trash`、外部変更の自動検知・iCloud・スクリーンショット・ハプティクス・クイックアクション等は動きません。デスクトップ版とモバイル版は同時に読み込めず、後から読み込んだ方に置き換わります。
- 確認環境: Android版(Obsidian 1.14.4)・iOS版(1.13.6)の `public` で、vault作成 → ノート作成・リネーム・削除・6MBの添付ファイル読み書き → ページ再読み込み後の復元まで、Chromiumで確認しています(日本語UIも表示されます)。

## 公開時の注意(重要)
**Obsidian本体は再配布できません。**

## 対応ブラウザ
- **Chrome / Edge などChromium系(デスクトップ)**: フォルダ選択を含め全機能
- Firefox / Safari: フォルダ選択(File System Access API)がないため「ブラウザ内お試しvault」のみ。Safariは書き込みAPIの都合で動かないことがあります

## 仕組みと制限
- ファイル操作は File System Access API。デスクトップ/書類/ダウンロードなど**フォルダそのもの**はブラウザの制限で選べません(中のサブフォルダはOK)。
- **外部変更の検知**はポーリング(約4秒ごと + ウィンドウにフォーカスが戻った時)。ファイルが非常に多いvaultでは間隔が自動で延びます。
- ごみ箱は `<vault>/.trash`。ファイルの更新日時の書き換え(`utimes`)はAPI上できないため無視されます。
- フォルダのリネームは、ブラウザが `move()` に対応していなければ「コピー→削除」で行うため、大きなフォルダでは時間がかかります。
- コミュニティプラグイン/テーマの取得などHTTP通信は**ブラウザのCORS制限を受けます**(GitHubは概ねOK)。
- 1ブラウザプロファイルにつき1 vault(ランチャーで選び直すと切り替わります)。
- 「既定のアプリで開く」「エクスプローラーで表示」、Webビューア、スクリーンショット系は動きません。
- 配信時に `app.js` の1箇所を置換します(設定画面などを別ウィンドウにしない)。
