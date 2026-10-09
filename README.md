# obsidian-web

自分の `obsidian.asar`(Obsidian 1.14.4で検証)を、Electronアプリではなく**普通のブラウザで**使うためのラッパーです。
用途に応じて2つの版があります。

| | **サーバー版** `obsidian-web-dynamic/` | **静的サイト版** `obsidian-web-static/` |
|---|---|---|
| 必要なもの | Python 3(標準ライブラリのみ) | 静的ファイルの配信だけ(HTTPS or localhost) |
| vault(ノートの場所) | サーバーを動かすマシン上のフォルダ | ブラウザで選んだPCのフォルダ(またはブラウザ内) |
| Obsidian本体 | 起動時に `--asar` で指定、サーバー側で展開 | ランチャーが読み込み、ブラウザ内に保存 |
| 対応ブラウザ | 一般的なブラウザ(検証はChromium) | フォルダ選択はChrome/Edge等のChromium系のみ |
| 別のPC/スマホから | 可(トークン付きURL + トンネル等) | ホスト先を開くだけ。ただしフォルダ選択はデスクトップChromiumのみ |
| 外部変更の検知 | 約1.5秒ごとのポーリング | 約4秒ごと + フォーカス復帰時 |
| 向いている用途 | 手元・自宅サーバーで安定して使う | サーバーを立てたくない、PCのフォルダをそのまま使いたい |

迷ったら: **PCのフォルダをそのまま開きたい → 静的サイト版**、**サーバーマシンのフォルダを複数端末から使いたい → サーバー版**。

---

## 1. サーバー版(`obsidian-web-dynamic/`)

Electronのメインプロセス相当をPythonで置き換えます。

```bash
cd obsidian-web-dynamic
python server.py --asar obsidian.asar --vault ./MyVault
```
表示された `http://localhost:8765/?token=...` をブラウザで開きます。

- 初回だけasarを `.obsidian-web/app` に展開します。2回目以降は `--asar` 不要です。
- `--vault` が存在しなければ作成し、サンプルノートを入れます。
- トークンは `.obsidian-web/token` に保存され、再起動後も同じURLが使えます。
- オプション: `--port`, `--host`, `--cache`, `--verbose`

**構成**: `server.py`(静的配信 / 同期IPC / vault内限定のファイルAPI / 画像配信)、`web/shim.js`(`require('electron'|'fs'|'path'...)` 等のブラウザ代替)、`README.md`

**セキュリティ**
- 既定は `127.0.0.1` のみ。Hostヘッダ検証 + トークンCookie(SameSite=Strict) + 独自ヘッダで、他サイトからの操作を拒否します。
- ファイル操作はvault内に限定(シンボリックリンクでの脱出も拒否)。
- `0.0.0.0` で公開する場合は、必ずSSHトンネルやHTTPS付きリバースプロキシ越しにしてください。

---

## 2. 静的サイト版(`obsidian-web-static/`)

サーバーなしで、ファイルを置くだけで動きます。本体の読み込みはService Worker + ブラウザ内展開で行い、ファイル操作はFile System Access APIです。

```bash
cd obsidian-web-static
python -m http.server 8800      # → http://localhost:8800/
```
ランチャー(`index.html`)で ①本体を読み込む → ②フォルダを選ぶ → ③開く。

### Obsidian本体の渡し方(アップロード不要にできます)
| 方法 | やること |
|---|---|
| **A** | `obsidian.asar` を `obsidian-web-static/` に置く |
| **B** | `python prepare.py obsidian.asar` で `obsidian/` と一覧 `ow-files.json` を作る |
| **C** | 何も置かず、ランチャーの「asarファイルを手動で選ぶ」から指定する |

A・Bは初回アクセス時に自動で読み込まれます(両方あればB優先)。差し替え後は「このサイトから読み込み直す」を押してください。

**構成**: `index.html` / `launcher.js`(ランチャー)、`sw.js`(Service Worker)、`app-shim.js`(Electron/Node APIの代替)、`prepare.py`(任意)、`README.md`

**対応ブラウザ**: フォルダ選択はChrome/Edgeなどデスクトップ版のみ。Firefox/Safariは「ブラウザ内お試しvault」だけが使えます(Safariは動かないことがあります)。

---

## 共通の注意

### 公開について(重要)
**Obsidian本体は再配布できません。**
- このリポジトリ/フォルダのコードには、Obsidian本体は含まれていません。

### 共通の制限
- 1サーバー(静的版は1ブラウザプロファイル)につき1 vault。切り替えUIは動きません。
- 「既定のアプリで開く」「エクスプローラーで表示」、Webビューア、スクリーンショット系は動きません。
- ごみ箱は `<vault>/.trash`。
- `app.js` は配信時に1箇所だけ置換します(設定画面などを別ウィンドウにしない)。元のasarは変更しません。
- コミュニティプラグイン/テーマの取得は、サーバー版ではサーバー経由、静的版ではブラウザのCORS制限を受けます。

## Obsidian本体（obsidian.asar）の格納場所（フルパス）（たぶんです。ない場合は頑張って探してください。）

お使いのOSに合わせて、以下のパスから `obsidian.asar`（または `obsidian-1.xx.x.asar`）を取得してください。
※ `[ユーザー名]` または `[Username]` の部分は、ご自身のPCのアカウント名に置き換えてください。

### 💻 Windows
* **自動アップデート版（推奨・最新データ）**
  `C:\Users\[ユーザー名]\AppData\Roaming\obsidian\`
* **通常のインストール先**
  `C:\Users\[ユーザー名]\AppData\Local\Obsidian\resources\obsidian.asar`

> 💡 **Windowsでの一発移動の裏技:**
> `Win + R` キーを同時に押し、ファイル名を指定して実行画面に `%APPDATA%\obsidian` と貼り付けて Enter を押すと、対象のフォルダが直接開きます。

### 🍎 Mac (macOS)
* **自動アップデート版（推奨・最新データ）**
  `/Users/[ユーザー名]/Library/Application Support/obsidian/`
* **アプリケーション本体の中**
  `/Applications/Obsidian.app/Contents/Resources/obsidian.asar`

> 💡 **Macでの一発移動の裏技:**
> Finderを開いた状態で `Cmd + Shift + G` キーを同時に押し、フォルダの場所を入力画面に `~/Library/Application Support/obsidian` と貼り付けて Enter を押すと直接移動できます。

### 🐧 Linux
* **自動アップデート版**
  `/home/[ユーザー名]/.config/obsidian/`

## フォルダ構成
```
.
├── README.md                  ← このファイル
├── obsidian-web/              サーバー版
│   ├── server.py
│   ├── web/shim.js
│   └── README.md
└── obsidian-web-static/       静的サイト版
    ├── index.html
    ├── launcher.js
    ├── sw.js
    ├── app-shim.js
    ├── prepare.py
    └── README.md
```
