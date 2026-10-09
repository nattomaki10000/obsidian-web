# obsidian-web-dynamic

自分の `obsidian.asar` を、Pythonサーバー経由で普通のブラウザから使うためのラッパーです。
Electronのメインプロセス相当をPython(標準ライブラリのみ)で置き換えています。

## 使い方
```bash
cd obsidian-web-dynamic
python server.py --asar obsidian.asar --vault ./MyVault
```
表示された `http://localhost:8765/?token=...` をブラウザで開きます。
- 初回のみasarを `.obsidian-web/app` に展開します(2回目以降は `--asar` 不要)。
- `--vault` が存在しなければ作成し、Obsidianのサンプルノートを入れます。
- トークンは `.obsidian-web/token` に保存され、再起動しても同じURLが使えます。
- オプション: `--port`, `--host`, `--cache`, `--verbose`

## 構成
- `server.py` : 静的配信 / 同期IPC(`/__ipc/*`) / vault内限定のファイルAPI(`/__fs/*`) / 画像等の配信(`/__vault/*`)
- `web/shim.js` : ブラウザ上の `require('electron'|'fs'|'path'...)`, `Buffer`, `process` の代替

## セキュリティ
- 既定は `127.0.0.1` のみ。Hostヘッダ検証 + トークンCookie(SameSite=Strict) + 独自ヘッダで、他サイトからの操作を拒否します。
- ファイル操作はvault内に限定(シンボリックリンクでの脱出も拒否)。
- `0.0.0.0` で公開する場合は、必ずSSHトンネルやHTTPS付きリバースプロキシ越しにしてください。

## 制限事項
- 1サーバー=1 vault(vaultの切替/作成UIは非対応)。複数使うならサーバーを複数起動。
- 「既定のアプリで開く」「エクスプローラーで表示」、Webビューア、スクリーンショット系は動きません。
- ファイル監視はポーリング(約1.5秒)。ごみ箱は `<vault>/.trash`。
- app.jsは配信時に1箇所だけ置換(設定画面を別ウィンドウにしない)。元ファイルは変更しません。
- Obsidian本体は再配布できません。このフォルダには含まれず、ご自身のasarから展開します。
