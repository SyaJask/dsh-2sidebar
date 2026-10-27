# npm 发布手册（dsh-2sidebar）

包的发布目录是 `plugin/`（`plugin/package.json` 才是整个 npm 包，仓库根目录不是包）。CI 工作流在
`.github/workflows/publish.yml`。

## 0. 当前状态（2026-10-28）

- 已发布 `dsh-2sidebar@0.1.0`（registry 时间 `2026-10-27T16:45:34Z`，手动发布，无 provenance）。
- Trusted Publishing 待配置；配置后由 tag 触发的发布自动带 provenance。
- 包名 `dsh-2sidebar` 已被本账号占用（`npm view dsh-2sidebar version` 返回 `0.1.0`）。
- 插件 id / locale 命名空间 / slot key / localStorage key 已从 `@local/dsh-split-files`
  改为 `dsh-2sidebar`；旧 localStorage 键仍会兜底读取一次。
- `plugin/package.json` 已去掉 `"private": true`，补齐 `license`、`repository`（`directory: plugin`）、
  `homepage`、`bugs`、`keywords`、`author`、`publishConfig.access`。
- 版本仍是 `0.1.0`：作为 npm 上的首个版本与现有 GitHub release 对齐。

## 1. 首次发布（必须手动）

Trusted publishing 只能给**已经存在**的 npm 包配置，所以第一次要走本地 token/OTP：

```powershell
cd plugin
node -e "console.log(require('./package.json').name + '@' + require('./package.json').version)"
npm pack --dry-run          # 确认 tarball 里没有 notes/tools/ref
npm login                   # 需要 2FA 时按提示输入 OTP
npm whoami                  # 确认登录的是自己的账号
npm profile get --json      # 确认 "tfa": true —— 首次发布要求账号已开启 2FA
npm publish --access public --otp=<验证器里的 6 位码>
```

> npm 已要求所有发布者开启 2FA（或用带 bypass 2FA 的 granular access token）。
> `tfa: false` 的账号直接 `npm publish` 会得到
> `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.`
> 先去 <https://www.npmjs.com/settings/kaw0n/tfa> 绑定 authenticator app，再重新 `npm login` 后发布。

发布后立刻验证：

```powershell
npm view dsh-2sidebar version dist.tarball
npm view dsh-2sidebar repository homepage keywords
```

> 注意：npm 名字占用的窗口期不确定。确认可用后尽快发布；如果在发布前被占用，只能换名或改用 scope
> （例如 `@syaJask/dsh-2sidebar`，需要同时改包名、bundle patch 的 `name`、`PACKAGE_ID` 和 smoke 断言）。

## 2. 配置 Trusted Publishing（一次性）

1. 打开 `https://www.npmjs.com/package/dsh-2sidebar/access`（或包页面 → Settings）。
2. **Trusted publishing** → 添加 GitHub Actions：
   - Organization or user: `SyaJask`
   - Repository: `dsh-2sidebar`
   - Workflow filename: `publish.yml`
   - Environment: 留空
3. 保存。之后 `publish.yml` 在 tag push 时用 OIDC 发布，不需要 `NPM_TOKEN`，并自动带 provenance。

## 3. 后续版本发布

1. 改 `plugin/package.json` 的 `version`（semver）。
2. 提交并推送。
3. 打 tag 并推送：

```powershell
git tag v0.1.1
git push origin v0.1.1
```

工作流会校验 tag 与 `plugin/package.json` 的版本一致，然后 `npm publish --provenance`。
tag 与版本不一致时工作流会失败，这是刻意的。

也可以在 GitHub Actions 页面手动 `Run workflow`（`workflow_dispatch`），但**仍然要求**
`plugin/package.json` 的版本是一个尚未发布过的版本。

## 4. 发布顺序（重要）

README（根目录与 `plugin/README.md`）现在把 npm 安装写成首选方式。请**先完成 npm 发布，再推送 README**，
否则文档里的 `dsh plugin add dsh-2sidebar` 会暂时 404。

如果本机之前用 `link:` 装过旧包（`@local/dsh-split-files`），先清掉旧 junction 再装新包，避免同一个
界面被两个 id 重复注册。当前机器上 `node_modules\@local\dsh-split-files` 有一个未激活的残留 junction
（不在 `dependencies` / `dsh.profile.bundles` 里），可以用 `dsh plugin remove @local/dsh-split-files`
或手工删除该 junction。

发布完成后的验收顺序：

1. `npm view dsh-2sidebar version` 能看到版本；
2. GUI：**Plugins** → **Add plugin** → `dsh-2sidebar` → 安装 → 启用；
3. 标题栏分栏按钮、开始页引导卡片、页签三个入口都存在；
4. 卸载再重装一次，确认 `dsh plugin remove dsh-2sidebar` 干净；
5. 再更新 GitHub 仓库的 homepage 为 `https://www.npmjs.com/package/dsh-2sidebar`。

## 5. 回滚/撤回

- 发布内容有问题时优先 `npm deprecate dsh-2sidebar@<version> "reason"`，不要轻易 `unpublish`。
- 72 小时内可以 `npm unpublish dsh-2sidebar@<version>`；超过时限需要联系 npm 支持。
- 本地验证失败时，GitHub tag / release 可以删掉重来，npm 版本号一旦占用不能再用于同一版本号。

## 6. 故障排查

### `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`

原因：发布账号没有开启 2FA（`npm profile get --json` 里 `"tfa": false`）。npm 现在要求发布者必须具备 2FA，
光 `npm login` 不够，`--otp` 也无从输入。处理：

1. 打开 <https://www.npmjs.com/settings/kaw0n/tfa>，用 authenticator app（TOTP）开启 2FA，保存恢复码；
2. 回到终端 `npm login` 重新认证；
3. `npm publish --access public --otp=<当前验证器 6 位码>`。

不想用 authenticator 的备选方案是创建 granular access token（Publish 权限 + bypass 2FA），临时写进
`.npmrc` 后发布，再撤销 token；但 bypass 2FA 的 token 正在被 npm 限制，只建议作为一次性兜底，首个版本
发出去之后立刻改用 Trusted Publishing。

### `E404` 仍然出现

说明还没有发布成功。`npm view dsh-2sidebar` 404 是预期的"包不存在"，不是网络问题。

### `E409 ... cannot publish over previously published version`

`plugin/package.json` 的版本已经存在于 registry。改版本号（例如 `0.1.1`）再发；npm 版本号不可复用。

### `--otp=` 留空 / 命令没有任何输出，包仍 404

`--otp` 必须是当前 6 位 TOTP 验证码；空值 `--otp=` 等同于没提供，命令会直接退出，registry 上不会创建包。
直接用交互式发布最稳：

```powershell
npm publish --access public
# 出现 "Enter one-time password from your authenticator app:" 时输入当前验证码
```

或者用最新验证码（输入要快，30 秒轮换）：

```powershell
npm publish --access public --otp=123456
```

### `EOTP` / `invalid one-time password`

验证码过期或时钟不同步。等验证器刷新到下一个 6 位码再试；确认手机时间自动同步。
