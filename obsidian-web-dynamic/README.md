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
- オプション: `--port`, `--host`, `--cache`, `--verbose`, `--mobile-zip`, `--allow-host`

## スマホ版(APK / IPA の `public` フォルダのzip)も配信する
スマホ版Obsidianの `public` フォルダ(Androidは APK の `assets/public`、iOSは IPA の `Payload/App.app/public`)をzipにして、**この `server.py` と同じフォルダに置くだけ**です(`--mobile-zip public.zip` で場所を指定してもOK)。

```bash
python server.py --asar obsidian.asar --vault ./MyVault     # 同じフォルダに *.zip があれば自動で見つけます
```
- **アクセスした端末で出し分けます**: スマホ/タブレット(User-Agentが Android / iPhone / Mobile など)にはzipのモバイル版、PCにはasarのデスクトップ版。URLは同じ(`/?token=...`)です。
- 強制したいとき: `/?token=...&ui=mobile` / `&ui=desktop`。モバイル版を Android 動作・iOS 動作のどちらにするかは `&platform=android` / `&platform=ios` で指定できます。
- zipの名前は何でもOK(中身で判定。`public/` などの親フォルダがあってもなくても可)。**Android用とiOS用の2つ**を置いた場合は、ファイル名に `android` / `apk` または `ios` / `ipa` を含めておくと、端末に合う方が配信されます。名前で区別できない場合は、1つ目が使われます。
- asarが無くてもzipだけで起動できます(その場合はPCにもモバイル版が出ます)。
- モバイル版のvaultは **サーバーの `--vault` フォルダそのもの**です(ディスク上の実ファイル)。モバイル側からは「vaultが1つだけある端末」に見え、初回は自動でそのvaultを開きます。サーバー側でファイルを変更すると、約1.5秒以内にモバイル版にも反映されます。
- スマホから使うには、サーバーを `--host 0.0.0.0`(または LAN のIP)で起動し、そのアドレスを `--allow-host 192.168.x.x:8765` のように許可します。**上の「セキュリティ」の注意(HTTPSのリバースプロキシやSSHトンネル経由が安全)に従ってください。**
- 制限: 他のフォルダを選ぶ機能(Device storage / Open folder as vault)・iCloud・スクリーンショット・振動は動きません。ごみ箱は `<vault>/.trash`。

## 構成
- `server.py` : 静的配信 / 同期IPC(`/__ipc/*`) / vault内限定のファイルAPI(`/__fs/*`) / 画像等の配信(`/__vault/*`)
- `web/shim.js` : ブラウザ上の `require('electron'|'fs'|'path'...)`, `Buffer`, `process` の代替
- `web/mobile-shim.js` : モバイル版用。Capacitorプラグイン(Filesystem など)の代替で、ファイル操作は `/__fs/*` 経由でvaultフォルダに届きます

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
