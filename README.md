# カラオケ・セレクター

カラオケで他の人が歌った2曲から、共通点のある同年代・類似系統の実在する曲を5〜10曲おすすめするWebアプリです。スマートフォンのホーム画面に追加して使えるPWAで、サーバーは不要です。

- 仕様: [karaoke_song_recommender_spec.md](karaoke_song_recommender_spec.md)
- 楽曲データ: iTunes Search API と [MusicBrainz](https://musicbrainz.org/)。どちらもAPIキー不要で、ブラウザから直接呼びます。
- 検索した曲名・アーティスト名は、使っている端末から上記2つのサービスへ直接送信されます。履歴・お気に入りはその端末のブラウザ内にだけ保存されます。
- カラオケの配信状況は確認していません。

## 使い方

公開URLをスマートフォンで開きます。

- Android (Chrome): メニューの「アプリをインストール」
- iPhone (Safari): 共有ボタンの「ホーム画面に追加」

## 開発

Node.js 20 以上が必要です。依存パッケージはありません。

```
npm start        # http://127.0.0.1:3000 で public/ を配信(開発用)
npm run check    # オフラインの自動テスト(外部APIには接続しない)
npm run eval     # 実際のAPIに接続して推薦品質を評価(数分かかります)
```

`PORT` などの設定は [.env.example](.env.example) を参照してください(開発用サーバーとテスト用の設定です。公開するアプリ本体は使いません)。

## 構成

| 場所 | 内容 |
|---|---|
| `public/` | 公開するアプリ本体(これだけをホスティングに置けば動きます) |
| `public/js/core/` | 推薦ロジックとデータ提供元との通信。ブラウザと開発用サーバーで共通 |
| `server/` | 開発用の静的配信サーバーと、テスト・評価用の `/api` |
| `scripts/` | 自動テスト (`smoke.js`) と推薦品質の評価 (`eval.js`) |

## 公開 (GitHub Pages)

`main` ブランチに push すると、GitHub Actions がテストを実行し、通った場合だけ `public/` を GitHub Pages に公開します([.github/workflows/pages.yml](.github/workflows/pages.yml))。

`public/` の中身は相対パスだけで書かれているため、`https://<ユーザー名>.github.io/<リポジトリ名>/` のようなサブパスでも動きます。

## 注意

- MusicBrainz は利用回数に制限があり、続けて何度も実行すると一時的に失敗することがあります。
- 曲調・ボーカル構成などは、タグやジャンルからの推定です。
- ブラウザは User-Agent を設定できないため、MusicBrainz が求める連絡先入りの識別を送れません。利用規約を確認のうえ運用してください。
