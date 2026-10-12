# obsidian-web

自分の `obsidian.asar`(Obsidian 1.14.4で検証)を、Electronアプリではなく**普通のブラウザで**使うためのラッパーです。
スマホ版Obsidianの **APK / IPA から取り出した `public` フォルダ(zip)** にも対応していて、アクセスした端末に合わせて、PCにはasar版、スマホにはモバイル版を出し分けます。

> [!IMPORTANT]
> **Obsidian本体は再配布できません。** このリポジトリにObsidian本体は含まれていません。`obsidian.asar` や `public` フォルダは、ご自身が入手したものを使ってください。公開サイトに置く場合も、本体を含めないでください。

## 3つの版

使い方に合わせて、3つの版があります。**詳しい使い方は、各フォルダのREADMEを見てください。**

| | [サーバー版](obsidian-web-dynamic/) | [静的サイト版](obsidian-web-static/) | [KV + Pages版](obsidian-web-kv-pages/) |
|---|---|---|---|
| フォルダ | `obsidian-web-dynamic/` | `obsidian-web-static/` | `obsidian-web-kv-pages/` |
| 必要なもの | Python 3(標準ライブラリのみ) | 静的ファイルの配信だけ(HTTPS or localhost) | Cloudflareアカウント(無料枠でOK) |
| vault(ノートの場所) | サーバーを動かすマシン上のフォルダ | ブラウザで選んだPCのフォルダ(またはブラウザ内) | Workers KV(クラウド) |
| Obsidian本体 | 起動時に `--asar` で指定 | ランチャーが読み込み、ブラウザ内に保存 | 端末ごとに読み込む(サイトには置かない) |
| 別の端末から | 可(トークン付きURL + トンネル等) | ホスト先を開くだけ。ただしフォルダ選択はデスクトップChromiumのみ | 可。**同じvaultを全端末で共有** |
| 認証 | トークン付きURL | なし | パスワード(ログイン画面) |
| 外部変更の検知 | 約1.5秒ごと | 約4秒ごと + フォーカス復帰時 | 他端末の変更は最大10分ほど(☁クリックで即時) |
| 費用 | 自前のサーバー | 静的ホスティング | 無料枠の範囲(KVの書き込みは1日1,000回まで) |

### どれを使う?

- **PCのフォルダをそのまま開きたい** → [静的サイト版](obsidian-web-static/)
- **自宅サーバーなどのフォルダを、複数の端末から使いたい** → [サーバー版](obsidian-web-dynamic/)
- **サーバーなしで、PC・スマホ・タブレットから同じvaultを使いたい** → [KV + Pages版](obsidian-web-kv-pages/)

## 各版のひとこと

- **サーバー版**: Electronのメインプロセス相当をPythonで置き換えます。vaultはサーバー上の実フォルダです。
- **静的サイト版**: ファイルを置くだけで動きます。Service Workerとブラウザ内展開で本体を動かし、フォルダ選択はFile System Access APIで行います。[インストールなしで試せます](https://nattomaki10000.github.io/obsidian-web/obsidian-web-static/)。
- **KV + Pages版**: 静的サイト版を改造し、Cloudflare PagesとWorkers KVで動かします。zipをアップロードしてSecretにパスワードを入れるだけで使えます。

## Obsidian本体の入手場所

<details>
<summary>obsidian.asar(PC版)</summary>

`[ユーザー名]` は自分のアカウント名に置き換えてください。場所は環境によって違うことがあります。

| OS | 場所 |
|---|---|
| Windows(自動アップデート版・推奨) | `C:\Users\[ユーザー名]\AppData\Roaming\obsidian\` |
| Windows(通常のインストール先) | `C:\Users\[ユーザー名]\AppData\Local\Obsidian\resources\obsidian.asar` |
| Windows(こちらかもしれません) | `C:\Users\[ユーザー名]\AppData\Local\Programs\Obsidian\resources\obsidian.asar` |
| Mac(自動アップデート版・推奨) | `/Users/[ユーザー名]/Library/Application Support/obsidian/` |
| Mac(アプリ本体の中) | `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` |
| Linux(自動アップデート版) | `/home/[ユーザー名]/.config/obsidian/` |

近道: Windowsは `Win + R` で `%APPDATA%\obsidian`、MacはFinderで `Cmd + Shift + G` から `~/Library/Application Support/obsidian` を開くと直接移動できます。

</details>

<details>
<summary>public フォルダ(スマホ版)</summary>

取り出した `public` フォルダをzipにして使います。AndroidのものでもiOSのものでも動きます。

| OS | 場所 |
|---|---|
| iOS(IPA) | `md.obsidian/Payload/App.app/public/` |
| Android(APK) | [公式サイト](https://obsidian.md/download)からAPKをダウンロードして展開し、`Obsidian-x.x.x/assets/public/` |

</details>

## 共通の制限

- vaultは、1サーバー(静的版・KV版は1ブラウザプロファイル)につき1つです。切り替えUIは動きません。
- 「既定のアプリで開く」「エクスプローラーで表示」、Webビューア、スクリーンショット系は動きません。
- ごみ箱は `<vault>/.trash` です。
- コミュニティプラグインやテーマの取得は、サーバー版ではサーバー経由、静的サイト版・KV版ではブラウザのCORS制限を受けます。

## フォルダ構成

```
.
├── README.md                  ← このファイル
├── index.html                 紹介ページ(GitHub Pages)
├── obsidian-web-dynamic/      サーバー版
│   ├── server.py
│   ├── web/shim.js
│   ├── web/mobile-shim.js
│   └── README.md
├── obsidian-web-static/       静的サイト版
│   ├── index.html
│   ├── launcher.js
│   ├── sw.js
│   ├── app-shim.js
│   ├── mobile-shim.js
│   ├── prepare.py
│   └── README.md
└── obsidian-web-kv-pages/     KV + Pages版
    ├── obsidian-web-kv-pages.zip   Pagesにアップロードするzip
    └── README.md
```

Obsidianは、その開発元の商標・著作物です。このプロジェクトは公式のものではありません。
