# obsidian-web (静的サイト版)

サーバー(Python等)なしで、**静的ファイルを置くだけ**で動く版です。
Obsidian本体(`obsidian.asar`)を読み込ませ、PC上のフォルダをvaultとして使います。

## ファイル
| ファイル | 役割 |
|---|---|
| `index.html` / `launcher.js` | ランチャー(本体の読み込み・フォルダ選択・起動) |
| `sw.js` | Service Worker(展開済みアプリの配信、vault内の画像などの配信) |
| `app-shim.js` | Electron/Node API(`require`, `fs`, `path` …)のブラウザ代替 |
| `prepare.py` | (任意)asarを解凍し、ファイル一覧 `ow-files.json` を作る |

## Obsidian本体の渡し方(3通り)
アップロード操作は不要にできます。ランチャーは次の順に自動検出します。

**A. `obsidian.asar` をこのフォルダに置く(いちばん簡単)**
```
obsidian-web-static/
├── index.html ...
└── obsidian.asar      ← ここに置く
```
**B. 解凍済みの `obsidian/` フォルダを置く**(約28MBのasarを配信したくない場合)
```bash
cd obsidian-web-static
python prepare.py obsidian.asar     # → ./obsidian/ と ./obsidian/ow-files.json を作成
# 自分で解凍した場合: python prepare.py --manifest-only ./obsidian
```
静的ホストはフォルダの中身を列挙できないため、`ow-files.json`(ファイル一覧)が必要です。
A・Bの両方がある場合はBを使います。

**C. 手動で選ぶ**: 置いていない場合は、ランチャーの「asarファイルを手動で選ぶ」から指定します。

初回アクセス時に自動で読み込み、そのブラウザのCache Storageに保存します。2回目以降は再取得しません。
asarを新しいバージョンに差し替えたら、ランチャーの「このサイトから読み込み直す」を押してください。

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
