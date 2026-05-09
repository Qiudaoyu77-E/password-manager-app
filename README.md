# 本地密码管理工具

这是一个离线可用的本地密码管理网页。账号和密码会用主密码派生出的密钥加密后保存到浏览器 `localStorage`，不会上传到网络。

## 使用方式

1. 双击桌面上的“密码管理工具”，或运行 `launch-password-manager.vbs`。

2. 如果需要在 PowerShell 里手动启动，可以执行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-local-server.ps1
   ```

3. 页面地址是：

   ```text
   http://localhost:8787
   ```

4. 第一次进入时设置主密码。之后用同一个主密码解锁。

不需要互联网也能使用。建议通过桌面入口打开；直接打开 `index.html` 时，部分浏览器可能限制“一键复制”或加密接口。

## 功能

- 添加、编辑、删除密码条目
- 按名称、网址、账号、标签搜索
- 一键复制账号和密码
- 打开登录网站
- 生成随机密码
- 导出、导入加密备份
- 可选 GitHub 私密 Gist 加密同步，方便电脑和 iPhone 共用同一个金库

## 注意

主密码不会保存，也无法找回。导出的备份仍然是加密文件，请妥善保存。

## 电脑和 iPhone 同步

要让电脑更新后手机也能使用，需要一个云端中转位置。本工具支持 GitHub 私密 Gist 同步：上传前保存的仍然是加密金库，GitHub 只能看到密文。

基本流程：

1. 创建一个 GitHub token，权限选择 `gist`。
2. 电脑打开“同步设置”，填入 token，Gist ID 可以先留空。
3. 点击“同步到云端”，工具会自动创建一个私密 Gist，并把 Gist ID 保存下来。
4. iPhone 用 Safari 打开这个工具的 HTTPS 发布地址，添加到主屏幕。
5. iPhone 里填同一个 token 和 Gist ID，点击“从云端同步”，再输入主密码解锁。

注意：如果只是访问电脑的 `localhost:8787`，iPhone 不能直接打开。手机端需要把这个网页发布到 HTTPS 地址，例如 GitHub Pages 或 Cloudflare Pages。
