# GitHub Pages 永久发布

这个工程已经支持静态 PWA 发布：`docs/` 是最终网站目录，里面包含阅读器、章节索引和 PDF 数据。GitHub Pages 可以直接托管它，读者打开网页后也可以把它安装到手机或电脑桌面。

## 第一次发布

1. 在 GitHub 新建一个仓库，例如 `guzhenren-reader`。
2. 在本目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\Publish-GitHubPages.ps1" -RemoteUrl "https://github.com/<你的用户名>/guzhenren-reader.git"
```

3. 打开 GitHub 仓库的 `Settings -> Pages`。
4. 推荐把 `Source` 选为 `GitHub Actions`，仓库里的 `.github/workflows/pages.yml` 会自动发布 `docs/`。
5. 也可以选择 `Deploy from a branch`，分支选 `main`，目录选 `/docs`。
6. 保存后等待 GitHub Pages 给出访问地址。

如果这台电脑还没登录 GitHub，`git push` 会要求登录。登录完成后重新运行同一条命令即可。

## 以后更新章节

每做完新章节 PDF 后，在本目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\Publish-GitHubPages.ps1"
```

脚本会重新生成 `docs/data/chapters.json`、复制 `D:\蛊真人漫画\pdf` 里的 PDF，并提交推送。重复章节会自动在书架里优先显示较新的 PDF。

如果 `git push` 因网络中断失败，可以走备用 API 发布：

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\Publish-GitHubViaApi.ps1"
```

备用脚本会读取当前 Windows 凭据管理器里的 GitHub 登录令牌，只上传发生变化的文件，并自动尝试启用 GitHub Pages。

## 读者安装

读者打开 GitHub Pages 地址后，可以用浏览器菜单里的“安装应用”“添加到主屏幕”或“创建快捷方式”安装。已经打开过的阅读器外壳会离线缓存；具体章节 PDF 会在读者打开或缓存章节后保存在自己的浏览器中。

## 版权和公开范围

如果仓库设为公开，PDF 会被所有人访问和下载。请只公开你有权公开分发的内容；如果只想自己随时查看，可以把仓库设为 private，并用 GitHub Pages 的私有发布能力或改用私有托管。
