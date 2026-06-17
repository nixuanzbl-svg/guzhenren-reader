# 蛊真人漫画阅读小程序

这是一个微信小程序工程，位置：

`D:\蛊真人漫画\小程序\guzhenren-reader`

功能：

- 书架首页，支持导入 PDF 漫画文件。
- 使用 `wx.saveFile` 缓存导入的 PDF。
- 记录每本漫画上次阅读的滚动位置、页码和进度。
- 自定义下拉式阅读页，支持夜间、护眼、背景、亮度、页间距和自动阅读。
- 如果 PDF Canvas 渲染依赖还没构建，会自动提供系统 PDF 阅读兜底。

## 打开方式

1. 用微信开发者工具导入本目录。
2. AppID 可以先用测试号；`project.config.json` 默认是 `touristappid`。
3. 在本目录执行：

```powershell
npm install
```

如果这台机器没有 `npm`，可以改用内置的下载脚本：

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\install-pdfjs.ps1"
```

4. 在微信开发者工具中选择“工具 -> 构建 npm”。
5. 编译运行。

当前机器没有可直接调用的 `npm` 命令，所以依赖没有在本地安装。源码已经按小程序 npm 方式写好，构建后自定义 PDF 下拉渲染才会启用；未构建前仍可导入、缓存，并用系统 PDF 阅读器打开。

## 使用说明

微信小程序不能直接读取 Windows 上的 `D:\蛊真人漫画\pdf` 目录。实际使用时，把 PDF 发到微信聊天或文件传输助手，再在小程序里点“导入 PDF”选择文件。导入后小程序会把 PDF 保存到微信本地文件缓存中。

## Web 公网阅读器

本工程还包含一个 Web 阅读器，位于 `web` 目录，并通过 `tools\Start-PublicReader.ps1` 启动。

- 普通读者打开公网 `publicUrl`，只能阅读、刷新章节、选择章节缓存。
- 开发者打开 `publicUrl/admin.html`，使用 `tools\admin-password.local.txt` 中的口令登录后上传 PDF。
- 上传的 PDF 保存到 `D:\蛊真人漫画\pdf`，读者刷新网页后会同步新章节。
- 章节缓存保存为浏览器 IndexedDB 中的渲染页图片，不会改动正式 PDF 文件。

公网访问的详细启动、停止和故障说明见 `tools\PUBLIC_READER.md`。

## GitHub Pages 永久 App

临时公网地址依赖本机服务和隧道。要做成可长期访问、可安装的网页 App，运行：

```powershell
node ".\tools\build-static-site.cjs"
```

脚本会生成 `docs/`：

- `docs/index.html`：GitHub Pages 入口。
- `docs/data/chapters.json`：静态章节目录。
- `docs/pdf/`：从 `D:\蛊真人漫画\pdf` 复制出的 PDF 数据。
- `docs/manifest.webmanifest` 和 `docs/sw.js`：浏览器安装与缓存支持。

完整发布步骤见 `PUBLISH_GITHUB.md`。

## 技术边界

微信小程序原生只提供 `wx.openDocument` 打开 PDF，不能在原生 PDF 阅读器里控制下拉样式或读取精确页码。因此本工程使用 `pdfjs-dist` 把 PDF 渲染到小程序 Canvas，才实现自定义下拉阅读和阅读位置记忆。复杂 PDF 如果 Canvas 渲染失败，可以点阅读页里的“PDF”按钮走系统阅读器。
