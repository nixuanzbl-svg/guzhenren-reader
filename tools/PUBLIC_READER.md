# 公网访问漫画阅读器

这个目录提供两个脚本，让漫画阅读器通过 Cloudflare Quick Tunnel 暴露为公网网页。

## 启动

```powershell
powershell -ExecutionPolicy Bypass -File "D:\蛊真人漫画\小程序\guzhenren-reader\tools\Start-PublicReader.ps1"
```

脚本会：

- 启动本地漫画阅读器 API 服务。
- 首次运行时下载 `cloudflared.exe`。
- 首次运行时生成开发者口令文件 `admin-password.local.txt`。
- 创建一个 `https://*.trycloudflare.com` 公网地址。
- 将当前 URL 和进程信息写入 `public-reader.session.json`。

手机和电脑不需要连接同一个 Wi-Fi，只要能访问互联网即可打开这个公网 URL。

## 两种模式

- 普通读者访问 `publicUrl`，只能阅读漫画、刷新章节、选择章节缓存。
- 开发者访问 `publicUrl/admin.html`，输入 `admin-password.local.txt` 里的口令后，可以上传 PDF。
- 开发者上传的 PDF 会保存到 `D:\蛊真人漫画\pdf`。
- 普通读者刷新网页后，会通过 `/api/chapters` 同步最新章节。
- 不提供删除、覆盖、替换接口；需要清理正式 PDF 时按项目安全规则手动处理单个明确文件。

## 缓存说明

- 普通页的“缓存所选”缓存的是渲染后的页面图片，保存在每个读者自己的浏览器 IndexedDB 中。
- 缓存不会写入或删除 `D:\蛊真人漫画\pdf` 里的 PDF。
- “清理本章缓存”只清理当前浏览器里的该章页面图片缓存。

## 停止

```powershell
powershell -ExecutionPolicy Bypass -File "D:\蛊真人漫画\小程序\guzhenren-reader\tools\Stop-PublicReader.ps1"
```

停止脚本只停止本次公网访问相关进程，不删除 PDF、缓存或网页文件。

## 注意

- 电脑必须保持开机，脚本进程必须保持运行。
- `trycloudflare.com` 地址是临时地址；重新启动脚本后可能会变。
- 当前公网 URL、进程号和日志路径见 `public-reader.session.json`。
- 如果公网返回 520、530 或 Bad Gateway，通常是 Cloudflare Quick Tunnel 临时断线；先等几秒刷新，仍失败就重新运行启动脚本。
