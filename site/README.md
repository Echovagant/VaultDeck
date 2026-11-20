# VaultDeck 官网

VaultDeck 的对外介绍页面，源码位于本仓库 `site/`。纯静态 HTML / CSS / 原生 JS，无构建步骤，页面零第三方请求。

## 线上地址

https://echovagant.github.io/VaultDeck/

## 发布

GitHub Pages 托管，单仓单源：`.github/workflows/pages.yml` 在 `site/**` 有改动推送到 main 时自动部署，无需手工步骤。

## 本地预览

任意静态服务器指向本目录即可，例如：

```
python -m http.server 8412
```

## 素材与事实来源

界面截图与主仓库 `docs/assets/screenshots/` 为同一批文件（SHA-256 一致），在 `assets/shots/` 保留一份拷贝，保证 Pages 部署产物自包含；页面中的功能、性能数字与数据边界说明均以主仓库 README 为准。
