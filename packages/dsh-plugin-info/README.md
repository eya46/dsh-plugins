# @eya46/dsh-plugin-info

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件信息页。包名 `@eya46/dsh-plugin-info`，挂到当前 Profile 后，设置里会出现「插件信息」分区。

它只看 **Profile 用户自己加的插件**（`profiles/<name>/package.json` 的 `dependencies`），不把 `@deepseek-ai/dsh-base` 这类随发行版带的 bundle 算进去。默认展示全部用户插件；如需只看特定命名空间，可配置 `allowScopes`。

- 列出已安装插件、当前版本、来源（npm / 本地 / git）
- 对 registry 安装的包对照 `dist-tags.latest`，标出可更新
- 对 **GitHub Release 直装**的包（依赖是 `github.com/…/releases/download/<tag>/<file>.tgz` 链接），从依赖链接里解析出仓库和当前版本，对照该仓库的最新 Release 标出可更新——仓库与版本全部取自 profile 里的依赖信息和已安装的包信息，无需任何按插件配置；更新命令直接指向按新版本重写过的 tarball 链接，版本列表也会展示该仓库最近的 Release，点开可读对应 Release 说明
- 可更新时**直接点「升级」**，由 Host 的插件管理器执行升级（详见下文「升级」）；同时仍可一键复制 `dsh plugin --profile <当前 profile> add <包>@latest`（profile 从当前运行的 Profile 清单解析，web 端通常是 `web`）
- 展开后默认看最近 **10** 条版本
- 点某个版本读更新说明：优先 GitHub Release，没有就回落到相邻版本的 compare / commit

实现方式对齐 [dsh-model-meta-autofill](https://github.com/QJAG1024/dsh-model-meta-autofill)：Host 注册本机 HTTP API，Client half 通过 `dsh.client` 挂到 `settings.section`。

## 升级

「升级」按钮走 `POST /plugin-info/api/update`，Host 端**不自己跑 pnpm**，而是调用 DSH 自己的插件管理器（`ctx.pluginManager`），所以 profile 写锁、pnpm 执行环境、兼容性预检、HMR 重载全部是官方那一套。两条路径：

| 运行时 | 路径 | 行为 |
| --- | --- | --- |
| DSH ≥ 0.2.2-alpha.2（有 `pluginManager.updateBundle`） | `plugin-manager` | 直接调用官方 `updateBundle(name, version)`：先查目标版本（存在、声明 bundle、`engines.dsh` / DSH peer 接受当前 DSH），有 HMR 时先卸掉已安装版本再装目标版本，失败自动把旧版本装回来 |
| 更早的运行时（如当前 Desktop 0.2.1-rc.5） | `remove-and-install` | 官方 `updateBundle` 不存在，按官方内部同一顺序调用公开方法：`removeBundle(name)` → `installBundle("name@version", { saveExact: true, enabled })`；目标装失败就按 profile 里保存的 spec 把旧版本装回去 |

页面上会显示这一步停在哪（检查版本 / 卸载旧版本 / 安装新版本）、用的是哪条路径、是否要重启才生效，以及失败时管理器的原始诊断与回滚结果。

升级目标由 Host 校验，客户端只能选版本不能换包：

- registry 插件：目标必须是 registry 里**已发布**且**比已装版本新**的版本，否则拒绝
- GitHub Release 直装插件：Host 从已安装的依赖 spec 重建下载链接，要求请求里的 spec 与新版本链接一致且**同一个仓库**，避免把别人发布的 tarball 装进来

可升级的前提是 `listBundles` 里该包可读、没有 `readOnlyReason`（管理组件自身不可被替换）、`removable` 为真且声明了 semver 版本。本地 `file:` / `link:` 安装没有可比的 registry 版本，不显示升级按钮。

### 可选：dsh-better-sidebar 标签页

若 Profile 同时安装了 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) (≥0.4.0)，本插件会自动在侧边栏 `+` 菜单里多注册一个**插件信息**标签页（id `@eya46/dsh-plugin-info`，order 90，单实例），内容与设置页完全一致——侧边栏较窄，内部已做滚动/宽度适配。

实现是**软依赖**：不写 `peerDependencies`，不 `import 'dsh-better-sidebar'`，只用 Cordis 的 `ctx.inject(['betterSidebar'], ...)` 开一个子 fiber——未安装时回调永不触发，其他功能不受影响；禁用 / HMR 任一插件时 disposer 随各自 fiber 清理，不会残留 `"already registered"`。

## 安装

在仓库根目录构建后，把它加进当前 Profile：

```sh
pnpm install
pnpm --filter @eya46/dsh-plugin-info build
dsh plugin --profile web add "file:./packages/dsh-plugin-info"
```

`dsh.bundle` 会把 `@eya46/dsh-plugin-info` 写进该 Profile 的 bundle 列表。重启 `dsh web` 后，打开设置 → **插件信息**。

兼容的 DSH 版本：`^0.1.5-rc.2`（0.1.x）与 `^0.2.0-rc.2`（0.2.x，含当前 Desktop / Web 发行版）。**0.1.0 只声明了 `^0.1.5-rc.2`**，装在 0.2.0-rc.2 上会被插件管理器的兼容性预检拒绝（提示「要求 @deepseek-ai/dsh-host-webserver ^0.1.5-rc.2」），请升级到 0.1.1 或更新版本。

## HTTP

本机回环可用：

| 端点 | 说明 |
| --- | --- |
| `GET /plugin-info/api/plugins` | 当前 Profile 用户插件 + 是否有更新；含 `profileCli`，可更新的 registry 包还会带 `updateCommand` |
| `GET /plugin-info/api/versions?name=<pkg>&limit=10` | 最近版本，默认 10 条 |
| `GET /plugin-info/api/notes?name=<pkg>&version=<ver>` | 该版本的更新说明 |
| `POST /plugin-info/api/update` | 执行一次升级，body `{ "name": "<pkg>", "version": "<目标版本>" }`；返回 `{ name, from, to, step, ok, application, reason?, output?, logPath?, restore?, route }` |

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `registryUrl` | `https://registry.npmjs.org` | npm 源 |
| `defaultVersionLimit` | `10` | 默认版本条数 |
| `timeoutMs` | `15000` | 注册表 / GitHub 超时 |
| `cacheTtlMs` | `300000` | packument 与说明缓存 |
| `allowScopes` | 无（展示全部） | 名称前缀白名单；省略或为空数组时展示全部用户插件 |

覆盖写在 Profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-plugin-info
  config:
    defaultVersionLimit: 10
```

本地 / `file:` / `link:` 安装没有 registry latest，不会标「可更新」。GitHub 说明在有 `repository` 字段时才会去拉；若遇到 API 限流，可在环境里设 `GITHUB_TOKEN`。

## 开发

```sh
pnpm install
pnpm --filter @eya46/dsh-plugin-info test
pnpm --filter @eya46/dsh-plugin-info build
```
