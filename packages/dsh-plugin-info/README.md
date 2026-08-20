# @eya46/dsh-plugin-info

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件信息页。包名 `@eya46/dsh-plugin-info`，挂到当前 Profile 后，设置里会出现「插件信息」分区。

它只看 **Profile 用户自己加的插件**（`profiles/<name>/package.json` 的 `dependencies`），不把 `@deepseek-ai/dsh-base` 这类随发行版带的 bundle 算进去。默认仅展示 `@eya46/` 命名空间下的插件（见下方 `allowScopes`），可按需放开。

- 列出已安装插件、当前版本、来源（npm / 本地 / git）
- 对 registry 安装的包对照 `dist-tags.latest`，标出可更新
- 展开后默认看最近 **10** 条版本
- 点某个版本读更新说明：优先 GitHub Release，没有就回落到相邻版本的 compare / commit

实现方式对齐 [dsh-model-meta-autofill](https://github.com/QJAG1024/dsh-model-meta-autofill)：Host 注册本机 HTTP API，Client half 通过 `dsh.client` 挂到 `settings.section`。

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

## HTTP

本机回环可用：

| 端点 | 说明 |
| --- | --- |
| `GET /plugin-info/api/plugins` | 当前 Profile 用户插件 + 是否有更新 |
| `GET /plugin-info/api/versions?name=<pkg>&limit=10` | 最近版本，默认 10 条 |
| `GET /plugin-info/api/notes?name=<pkg>&version=<ver>` | 该版本的更新说明 |

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `registryUrl` | `https://registry.npmjs.org` | npm 源 |
| `defaultVersionLimit` | `10` | 默认版本条数 |
| `timeoutMs` | `15000` | 注册表 / GitHub 超时 |
| `cacheTtlMs` | `300000` | packument 与说明缓存 |
| `allowScopes` | `['@eya46/']` | 名称前缀白名单；为空数组时展示全部用户插件 |

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
