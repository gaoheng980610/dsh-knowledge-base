/**
 * dsh-knowledge-base —— Host 半边。
 *
 * 职责：
 *   1. 作为知识库文件的唯一权威：扫描 / 读取 / 保存 / 删除 `$DSH_HOME/knowledge-base/`
 *      下的 Markdown 资料（含 YAML frontmatter）。
 *   2. 通过 webServer 暴露同源 HTTP 端点，供浏览器半边（lib/client.js）调用。
 *   3. 向 `ctx.tools` 注册 **会话可按需调用的检索工具**（kb_search / kb_read），
 *      使后续任何会话都能在需要时检索本地资料 —— 这是本插件与「纯浏览面板」的关键差别。
 *
 * 资料组织（目录即分类）：
 *   $DSH_HOME/knowledge-base/
 *     handbook/getting-started.md
 *     handbook/deployment-notes.md
 *     ops/troubleshooting.md
 *     .trash/            ← 删除的资料移到这里（可恢复）
 *
 * 每份资料的 id = 相对路径去掉 .md，用 / 分隔；例如 `handbook/getting-started`。
 *
 * 说明：正式插件的 Host 半边是普通 Node 模块，可直接使用 node:fs ——
 * 沙箱约束的是 agent 的工具调用，不是宿主插件代码。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROUTE_PREFIX = '/knowledge-base'
const ENTRY_EXT = '.md'
const TRASH_DIR = '.trash'
const MAX_BODY_BYTES = 4 * 1024 * 1024
const EXCERPT_LEN = 180

/**
 * 本插件依赖宿主 HTTP 载体（webServer）与工具注册表（tools）。
 *
 * ★ 两个踩过的坑，勿回退：
 *   1. cordis 里**没在 inject 中声明的服务，属性访问会直接抛异常**
 *      （`cannot get property "tools" without inject`）；apply 抛异常会让该 fiber
 *      的**全部 effect 被回滚**——连已注册的 HTTP 路由都会被撤销，表现为
 *      「面板能打开但接口 405」。所以 tools 必须声明。
 *   2. inject 只支持**数组**形式。写成 `{ required: [...], optional: [...] }`
 *      会被当成两个服务名，插件停在 `pending (waiting for services: required, optional)`。
 */
export const inject = ['webServer', 'tools']

/* ------------------------------------------------------------------ *
 * 路径
 * ------------------------------------------------------------------ */

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return path.join(os.homedir(), '.dsh')
}

/** 本插件的资料根目录。 */
export function dataDir() {
  return path.join(dshHome(), 'knowledge-base')
}

function trashDir() {
  return path.join(dataDir(), TRASH_DIR)
}

function ensureDirs() {
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.mkdirSync(trashDir(), { recursive: true })
}

/**
 * id → 绝对路径。拒绝任何越界（`..`、绝对路径、非 .md）。
 * 返回 null 表示非法。
 */
function idToPath(id) {
  if (typeof id !== 'string') return null
  const trimmed = id.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (trimmed === '') return null
  const withExt = trimmed.endsWith(ENTRY_EXT) ? trimmed : trimmed + ENTRY_EXT
  const root = dataDir()
  const abs = path.resolve(root, withExt)
  const rel = path.relative(root, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!abs.endsWith(ENTRY_EXT)) return null
  const segs = rel.split(path.sep)
  if (segs.some((s) => s === TRASH_DIR)) return null
  return abs
}

/** 绝对路径 → id（非资料文件返回 null）。 */
function pathToId(abs) {
  const root = dataDir()
  const rel = path.relative(root, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!rel.endsWith(ENTRY_EXT)) return null
  const segs = rel.split(path.sep)
  if (segs.some((s) => s === TRASH_DIR)) return null
  return segs.join('/').slice(0, -ENTRY_EXT.length)
}

function categoryOf(id) {
  const i = id.lastIndexOf('/')
  return i === -1 ? '' : id.slice(0, i)
}

function titleOf(id) {
  const i = id.lastIndexOf('/')
  return i === -1 ? id : id.slice(i + 1)
}

/* ------------------------------------------------------------------ *
 * frontmatter（极简 YAML 子集：仅标量 + 行内数组）
 * ------------------------------------------------------------------ */

function parseScalar(v) {
  let s = String(v).trim()
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1)
  }
  return s
}

function parseArray(v) {
  const s = String(v).trim()
  if (!s.startsWith('[') || !s.endsWith(']')) return null
  return s
    .slice(1, -1)
    .split(',')
    .map((x) => parseScalar(x))
    .filter((x) => x !== '')
}

/**
 * 拆出 frontmatter。没有 frontmatter 时 meta 为空对象、body 为原文。
 */
function splitFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { meta: {}, body: text, hasFrontmatter: false }
  const nl = text.indexOf('\n')
  if (nl === -1) return { meta: {}, body: text, hasFrontmatter: false }
  const end = text.indexOf('\n---', nl)
  if (end === -1) return { meta: {}, body: text, hasFrontmatter: false }
  const block = text.slice(nl + 1, end)
  let body = text.slice(end + 4)
  body = body.replace(/^\r?\n/, '')
  const meta = {}
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    const m = /^([A-Za-z0-9_\-.]+)\s*:\s*(.*)$/.exec(t)
    if (!m) continue
    const key = m[1]
    const val = m[2]
    const arr = parseArray(val)
    meta[key] = arr === null ? parseScalar(val) : arr
  }
  return { meta, body, hasFrontmatter: true }
}

function buildFrontmatter(meta) {
  const keys = ['title', 'tags', 'category', 'updated', 'source']
  const lines = []
  for (const k of keys) {
    const v = meta[k]
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(`${k}: [${v.join(', ')}]`)
    } else {
      lines.push(`${k}: ${String(v)}`)
    }
  }
  if (lines.length === 0) return ''
  return `---\n${lines.join('\n')}\n---\n\n`
}

/* ------------------------------------------------------------------ *
 * 摘录 / 搜索
 * ------------------------------------------------------------------ */

function plainText(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\d.\s|]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function excerptOf(body) {
  const t = plainText(body)
  return t.length > EXCERPT_LEN ? t.slice(0, EXCERPT_LEN) + '…' : t
}

function snippetOf(body, q) {
  const t = plainText(body)
  const lower = t.toLowerCase()
  const idx = lower.indexOf(q.toLowerCase())
  if (idx === -1) return excerptOf(body)
  const from = Math.max(0, idx - 60)
  const to = Math.min(t.length, idx + q.length + 90)
  return (from > 0 ? '…' : '') + t.slice(from, to) + (to < t.length ? '…' : '')
}

function countOccurrences(haystack, needle) {
  if (needle === '') return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let count = 0
  let pos = 0
  for (;;) {
    const i = h.indexOf(n, pos)
    if (i === -1) break
    count += 1
    pos = i + n.length
  }
  return count
}

/* ------------------------------------------------------------------ *
 * 扫描与读写
 * ------------------------------------------------------------------ */

function walk(dir, out) {
  let dirents
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue
    const abs = path.join(dir, d.name)
    if (d.isDirectory()) {
      walk(abs, out)
    } else if (d.isFile() && d.name.toLowerCase().endsWith(ENTRY_EXT)) {
      out.push(abs)
    }
  }
  return out
}

function readEntry(abs) {
  const raw = fs.readFileSync(abs, 'utf8')
  const { meta, body } = splitFrontmatter(raw)
  const id = pathToId(abs)
  if (id === null) return null
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    stat = { size: raw.length, mtimeMs: 0 }
  }
  return {
    id,
    title: typeof meta.title === 'string' && meta.title !== '' ? meta.title : titleOf(id),
    category: typeof meta.category === 'string' && meta.category !== '' ? meta.category : categoryOf(id),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    updated: typeof meta.updated === 'string' ? meta.updated : '',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    wordCount: plainText(body).length,
    excerpt: excerptOf(body),
    body,
    meta,
    path: abs,
  }
}

function listEntries() {
  ensureDirs()
  const files = walk(dataDir(), [])
  const entries = []
  for (const abs of files) {
    try {
      const e = readEntry(abs)
      if (e) entries.push(e)
    } catch {
      /* 单个文件坏掉不影响整体 */
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id))
  return entries
}

function searchEntries(q, limit) {
  const query = typeof q === 'string' ? q.trim() : ''
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20
  const all = listEntries()
  if (query === '') {
    return all.slice(0, max).map((e) => ({ ...stripBody(e), snippet: e.excerpt, score: 0 }))
  }
  const terms = query.split(/\s+/).filter((x) => x !== '')
  const hits = []
  for (const e of all) {
    const titleHay = `${e.title} ${e.id} ${e.category} ${e.tags.join(' ')}`.toLowerCase()
    const bodyHay = `${e.body}`.toLowerCase()
    let score = 0
    let allHit = true
    for (const t of terms) {
      const tl = t.toLowerCase()
      const inTitle = countOccurrences(titleHay, tl)
      const inBody = countOccurrences(bodyHay, tl)
      if (inTitle === 0 && inBody === 0) {
        allHit = false
        break
      }
      score += inTitle * 10 + Math.min(inBody, 20)
    }
    if (!allHit) continue
    hits.push({ ...stripBody(e), snippet: snippetOf(e.body, terms[0]), score })
  }
  hits.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)
  return hits.slice(0, max)
}

function stripBody(e) {
  const { body, meta, path: p, ...rest } = e
  return rest
}

function saveEntry({ id, title, tags, body, category, updated }) {
  ensureDirs()
  let targetId = typeof id === 'string' ? id.trim().replace(/\\/g, '/').replace(/^\/+/, '') : ''
  if (targetId === '') {
    const base = (title && String(title).trim()) || '未命名资料'
    targetId = `${(category && String(category).trim()) || '未分类'}/${base}`
  }
  const abs = idToPath(targetId)
  if (abs === null) throw new Error('非法的资料 id：' + id)
  const text = typeof body === 'string' ? body : ''
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('正文超过 4MB 上限')
  const meta = {
    title: (title && String(title).trim()) || titleOf(targetId),
    category: (category && String(category).trim()) || categoryOf(targetId),
    tags: Array.isArray(tags) ? tags : [],
    updated: (updated && String(updated).trim()) || new Date().toISOString().slice(0, 10),
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buildFrontmatter(meta) + text + (text.endsWith('\n') ? '' : '\n'), 'utf8')
  return { id: targetId, path: abs }
}

function deleteEntry(id) {
  ensureDirs()
  const abs = idToPath(id)
  if (abs === null) throw new Error('非法的资料 id：' + id)
  if (!fs.existsSync(abs)) throw new Error('资料不存在：' + id)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const flat = String(id).replace(/\//g, '__')
  const dest = path.join(trashDir(), `${stamp}__${flat}${ENTRY_EXT}`)
  fs.renameSync(abs, dest)
  return { id, trashedTo: dest }
}

/* ------------------------------------------------------------------ *
 * HTTP 载体
 * ------------------------------------------------------------------ */

function send(res, code, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES * 2) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function messageOf(e) {
  if (e && typeof e.message === 'string') return e.message
  return String(e)
}

/* ------------------------------------------------------------------ *
 * 插件装配
 * ------------------------------------------------------------------ */

export function apply(ctx) {
  let webServer
  try {
    webServer = ctx.get('webServer')
  } catch {
    webServer = undefined
  }
  if (webServer === undefined || webServer === null) {
    console.error('[knowledge-base] 缺少 webServer 服务，Host 半边未激活')
    return
  }

  try {
    ensureDirs()
  } catch (e) {
    console.error('[knowledge-base] 资料目录不可用：' + messageOf(e))
  }

  const disposeRoute = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = req.url ?? ''
      const action = url.slice(ROUTE_PREFIX.length).split('?')[0].replace(/^\//, '')
      try {
        const args = req.method === 'POST' ? await readJsonBody(req) : {}
        if (action === '' || action === 'list') {
          const entries = listEntries().map(stripBody)
          return send(res, 200, { ok: true, root: dataDir(), entries })
        }
        if (action === 'read') {
          const abs = idToPath(args.id)
          if (abs === null) return send(res, 200, { ok: false, error: '非法的资料 id' })
          if (!fs.existsSync(abs)) return send(res, 200, { ok: false, error: '资料不存在' })
          return send(res, 200, { ok: true, entry: readEntry(abs) })
        }
        if (action === 'save') {
          const r = saveEntry(args)
          return send(res, 200, { ok: true, id: r.id })
        }
        if (action === 'delete') {
          const r = deleteEntry(args.id)
          return send(res, 200, { ok: true, id: r.id })
        }
        if (action === 'search') {
          const hits = searchEntries(args.q, args.limit)
          return send(res, 200, { ok: true, hits })
        }
        if (action === 'stats') {
          const entries = listEntries()
          const byCat = {}
          for (const e of entries) byCat[e.category || '(未分类)'] = (byCat[e.category || '(未分类)'] || 0) + 1
          return send(res, 200, {
            ok: true,
            root: dataDir(),
            total: entries.length,
            categories: byCat,
            latest: entries.slice(0, 5).map(stripBody),
          })
        }
        return send(res, 404, { ok: false, error: '未知端点：' + action })
      } catch (e) {
        return send(res, 200, { ok: false, error: messageOf(e) })
      }
    },
  })
  ctx.effect(() => disposeRoute)

  /* -------------------- 会话可调用的检索工具 -------------------- */

  let tools
  try {
    tools = ctx.tools
  } catch {
    tools = undefined
  }

  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    console.error('[knowledge-base] ctx.tools 不可用，会话检索工具未注册（面板仍可用）')
    return
  }

  // 工具注册整段兜底：即使失败也不能让 cordis 回滚上面已注册的 HTTP 路由
  try {
    ctx.effect(
      () =>
        tools.register({
          name: 'kb_search',
          description:
            '检索本机「资料库」（$DSH_HOME/knowledge-base 下的 Markdown 资料/手册/排障记录）。' +
            '不传 query 时返回全部资料的目录（按分类与标题）。' +
            '当问题涉及内部系统、部署运维、产品配置、历史排障结论时，先调用它查资料库，再回答。',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '检索关键词（空格分隔多个词，全部命中才算匹配）。留空则列出全部资料目录。',
              },
              limit: { type: 'number', description: '最多返回条数，默认 20，上限 100。' },
            },
            required: [],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'object' },
            render: (_args, value) => {
              if (!value || value.ok === false) {
                return [{ type: 'text', text: '资料库检索失败：' + ((value && value.error) || '未知错误') }]
              }
              if (!value.hits || value.hits.length === 0) {
                return [{ type: 'text', text: `资料库中没有匹配「${value.query}」的资料。` }]
              }
              const lines = value.hits.map(
                (h, i) =>
                  `${i + 1}. [${h.id}] ${h.title}${h.category ? `  （分类 ${h.category}）` : ''}\n    ${h.snippet}`
              )
              return [
                {
                  type: 'text',
                  text: `资料库命中 ${value.hits.length} 条（资料根 ${value.root}）：\n${lines.join('\n')}\n\n用 kb_read 读取某条全文。`,
                },
              ]
            },
          },
          async execute(args) {
            try {
              const hits = searchEntries(args && args.query, args && args.limit)
              return { ok: true, root: dataDir(), query: (args && args.query) || '', hits }
            } catch (e) {
              return { ok: false, error: messageOf(e) }
            }
          },
          presentCall(args) {
            return {
              card: 'generic',
              title: '检索资料库',
              kind: 'read',
              rawInput: args && args.query ? String(args.query) : '(全部目录)',
            }
          },
        }),
      'knowledge-base kb_search tool'
    )

    ctx.effect(
      () =>
        tools.register({
          name: 'kb_read',
          description:
            '读取资料库中某一条资料的完整正文（Markdown）。id 来自 kb_search 的结果，例如 "handbook/getting-started"。',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '资料 id，形如 分类/文件名（不含 .md）。' },
            },
            required: ['id'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'object' },
            render: (_args, value) => {
              if (!value || value.ok === false) {
                return [{ type: 'text', text: '读取失败：' + ((value && value.error) || '未知错误') }]
              }
              return [
                {
                  type: 'text',
                  text: `# ${value.title}\n（id: ${value.id}${value.tags && value.tags.length ? ' · 标签: ' + value.tags.join(', ') : ''}）\n\n${value.body}`,
                },
              ]
            },
          },
          async execute(args) {
            try {
              const abs = idToPath(args && args.id)
              if (abs === null) return { ok: false, error: '非法的资料 id' }
              if (!fs.existsSync(abs)) return { ok: false, error: '资料不存在：' + args.id }
              const e = readEntry(abs)
              if (!e) return { ok: false, error: '资料不可读' }
              return {
                ok: true,
                id: e.id,
                title: e.title,
                tags: e.tags,
                category: e.category,
                body: e.body,
              }
            } catch (e2) {
              return { ok: false, error: messageOf(e2) }
            }
          },
          presentCall(args) {
            return {
              card: 'generic',
              title: '读取资料',
              kind: 'read',
              rawInput: args && args.id ? String(args.id) : undefined,
            }
          },
        }),
      'knowledge-base kb_read tool'
    )
  } catch (e) {
    console.error('[knowledge-base] 会话检索工具注册失败（面板仍可用）：' + messageOf(e))
  }
}
