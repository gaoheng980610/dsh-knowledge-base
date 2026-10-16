# dsh-knowledge-base · DSH 资料库

给 DeepSeek Harness 用的**本地 Markdown 资料库**插件：一边是给人看的可浏览面板，一边是给会话用的检索工具。

| 半边 | 文件 | 能力 |
|---|---|---|
| Host | `lib/index.js` | `node:fs` 读写 `$DSH_HOME/knowledge-base/`；`webServer` 开同源 HTTP 路由；向 `ctx.tools` 注册 **`kb_search` / `kb_read`** 两个 Agent 工具 |
| Browser | `lib/client.js` | `__ModuleLoader__` 装载；侧边栏「资料库」入口 + 中栏面板（搜索 / 分类树 / Markdown 阅读 / 在线编辑） |

## 安装

```sh
# 推荐：按 tag 从仓库安装（锁定到具体提交，可重复安装与升级）
dsh plugin --profile <你的 profile> add "github:gaoheng980610/dsh-knowledge-base#v0.1.1"
```

也可以装 Release 里的预构建压缩包：

```sh
dsh plugin --profile <你的 profile> add "https://github.com/gaoheng980610/dsh-knowledge-base/releases/download/v0.1.1/dsh-knowledge-base-0.1.1.tgz"
```

> 压缩包直链在 pnpm 11 上有已知问题：**第一次安装正常，再次安装/升级同一链接**会报
> `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（store 里已有该包，但 lockfile 条目没有 integrity 字段）。
> 需要重复安装或升级的，用上面的 `github:` 方式。

`dsh plugin add` 会同时把 `dsh-knowledge-base` 写进 profile `package.json` 的 `dsh.profile.bundles`；
装完**重启 DeepSeek Harness**——profile 的 bundle roster 在宿主进程启动时装载，
宿主半边（HTTP 路由 + Agent 工具）与浏览器半边都要重启后才生效。

卸载：`dsh plugin --profile <profile> remove dsh-knowledge-base`（若 `dsh.profile.bundles` 中仍留有该行，一并删掉）。

从源码改动迭代时可以用 link 方式安装（改完即时生效，仍需重启）：

```powershell
cd $env:DSH_HOME\profiles\<profile>
node <pnpm.mjs> add link:<本包路径>
```

## 为什么这样做

DSH 里**唯一跨会话可见且可检索**的载体是「技能目录 + 插件工具」。本插件把资料库做成插件，
于是同一份内容有两条取用通道：

- **会话**：任何会话都能调 `kb_search` / `kb_read`，按需取用，不用把资料塞进上下文
- **人**：GUI 侧边栏「资料库」面板，可搜索、阅读、在线新建/编辑

## 数据布局

```
$DSH_HOME/knowledge-base/          （默认 ~/.dsh/knowledge-base/）
  <分类>/<名称>.md                  ← 目录即分类；id = 相对路径去掉 .md
  .trash/                           ← 删除的资料（可恢复）
```

文件头支持 YAML frontmatter（`title` / `tags` / `category` / `updated` / `source`），
没有也能用（标题取文件名）。

**插件本体不含任何资料内容**：安装后资料目录是空的，资料由你自己写进去，只存在本机。

## Agent 工具

| 工具 | 说明 |
|---|---|
| `kb_search` | `{ query?, limit? }`。`query` 空格分词，**需全部命中**；**不传 query = 列出全部资料目录** |
| `kb_read` | `{ id }`。返回该资料全文 Markdown |

## HTTP 端点（浏览器半边用）

前缀 `/knowledge-base`，均 POST + JSON：

| 端点 | 入参 | 返回 |
|---|---|---|
| `list` | — | `{ ok, root, entries[] }`（**不含正文**） |
| `read` | `{ id }` | `{ ok, entry }`（含正文） |
| `save` | `{ id?, title, tags, body, category? }` | `{ ok, id }`；`id` 省略时按 `分类/标题` 新建 |
| `delete` | `{ id }` | `{ ok, id }`（移入 `.trash`） |
| `search` | `{ q, limit? }` | `{ ok, hits[] }`（按标题/正文计分，带摘要） |
| `stats` | — | `{ ok, total, categories, latest[] }` |

## 开发与自测

```bash
node --check lib/index.js
node --check lib/client.js
node test/smoke.mjs          # 离线冒烟：假 ctx/window/react 驱动两半边，36 项断言
```

`test/smoke.mjs` 不需要 DSH 就能跑，覆盖：路由全端点、frontmatter 读写、
全文搜索与计分、**路径穿越防护**、`.trash` 删除、两个 Agent 工具、
浏览器半边的槽注册与面板渲染。

## 踩坑记录（cordis · 勿回退）

### 1. 没在 `inject` 里声明的服务，属性访问会**直接抛异常**

```js
export const inject = ['webServer']    // 只声明了 webServer
const tools = ctx.tools                // ❌ Error: cannot get property "tools" without inject
```

**致命之处**：`apply()` 抛异常会让 cordis 把该 fiber 的**全部 effect 回滚**——
包括**已经注册成功的 HTTP 路由**。现象极具迷惑性：

- 浏览器半边独立加载 → 侧边栏「资料库」入口与面板**正常显示**
- 但所有接口返回 **405**（落到静态处理器），面板提示"无法连接 Host 半边"

修复：用到的服务都写进 `inject`；可选能力一律 `try/catch` 兜底。

### 2. `inject` 只支持**数组**形式

```js
export const inject = { required: ['webServer'], optional: ['tools'] }   // ❌
// 现象：插件停在 pending (waiting for services: required, optional)
```

对象形式不被该 cordis 版本支持——键名会被当成**服务名**去等待。只用数组：

```js
export const inject = ['webServer', 'tools']
```

### 3. 排查姿势：**一定要看宿主启动输出**

未激活的插件会写在启动输出里：

```
dsh: warning: 1 entry did not activate
ui-knowledge-base (dsh-knowledge-base): Error: cannot get property "tools" without inject
```

**快速迭代环境**（不必反复重启正在用的实例）：复制一份 profile，`node_modules`
用 junction 复用，换端口起独立实例：

```powershell
# profiles\kb-verify\package.json ← 复制 desktop；node_modules ← junction 到 desktop\node_modules
dsh --profile kb-verify --port 19997 --no-open --host 127.0.0.1
# 注意：语法是 dsh --profile <name> <app参数>，不要写成 dsh --profile x web
```

之后直接用 HTTP 打端点验证。用完记得先解除 junction 再删目录，避免误删 desktop 的 node_modules。

## 安全边界

- 所有 id 经 `idToPath()` 归一化并拒绝 `..` / 绝对路径 / 非 `.md`，**不能越出资料根目录**
- 正文单份上限 4MB；`list` 不返回正文，避免把整个资料库灌进上下文
- `delete` 是软删除（移入 `.trash`），可手工恢复
- 插件不引入任何第三方依赖（浏览器半边只用宿主内置的 `react`）
- 资料只在本机读写，插件不发起任何外部网络请求

## 许可

MIT
