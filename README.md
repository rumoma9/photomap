https://rumoma9.github.io/photomap/

# Photo Map

フィルムカメラで撮った写真と GPS トラックで、散歩や旅行の記録を地図にまとめたサイトです。

## 構成

| パス | 内容 |
|---|---|
| `index.html` | トップページ |
| `overview-map.html` | 全ルートの一覧地図 |
| `photo-map/<ルート名>.html` | 各ルートのページ |
| `photo-map/<ルート名>/map.html` | ルートの地図（GPS トラック・撮影地点） |
| `photo-map/<ルート名>/images/` | 写真（WebP） |
| `assets/` | テーマの CSS・JS・ロゴ |

このリポジトリには、[Zensical](https://zensical.org/) で生成した静的サイトの出力だけが入っています。

## 更新方法

サイトを生成し直して出力をこのフォルダに上書きしてから、次を実行します（履歴は1コミットにまとめています）。

    git add -A && git commit --amend -m "Update site" && git push -f

## ライセンス

写真と文章の著作権は作者に帰属します。無断での転載・再利用はご遠慮ください。
テーマの JS・CSS のサードパーティーライセンスは `assets/javascripts/LICENSE` を参照してください。
