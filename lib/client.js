/**
 * dsh-knowledge-base —— 浏览器半边。
 *
 * 加载协议：DSH 的 web 插件以 window.__ModuleLoader__.load({ id, factory }) 形式装载，
 * factory 收到的 require 能解析宿主内置模块（react / react-dom 等）。
 *
 * 浏览器半边不直接读文件，一切经同源 HTTP 走 Host 半边（见 lib/index.js 的
 * webServer 路由），这样资料的所有权与写盘只有一处权威。
 *
 * 面板结构：侧边栏「资料库」一行 + 中栏原生页面。
 *   左：搜索框 + 按分类分组的资料列表
 *   右：Markdown 阅读 / 在线编辑（新建 / 保存 / 删除）
 */

window.__ModuleLoader__.load({
  id: 'dsh-knowledge-base',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const SLOT_ID = 'knowledge-base'

    /* ----------------------------- Host RPC ----------------------------- */

    async function hostCall(method, args) {
      const res = await fetch('/knowledge-base/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args === undefined ? {} : args),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

    function insertStyles(css) {
      const el = document.createElement('style')
      el.setAttribute('data-dsh-knowledge-base', '')
      el.textContent = css
      document.head.appendChild(el)
      return () => {
        el.remove()
      }
    }

    /* ------------------------------ 样式 ------------------------------ */

    const CSS = `
.kb-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.55}
.kb-head{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6);flex:none}
.kb-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.kb-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4c6ef5)}
.kb-spacer{flex:1;min-width:0}
.kb-stat{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.kb-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,#dcdcdc);background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;cursor:pointer}
.kb-btn:hover{background:var(--dsw-alias-bg-layer-2,#f0f0f0)}
.kb-btn:disabled{opacity:.5;cursor:default}
.kb-btn-primary{background:var(--dsw-alias-brand-primary,#4c6ef5);border-color:transparent;color:#fff}
.kb-btn-danger{color:#c0392b}
.kb-body{flex:1;min-height:0;display:flex}
.kb-side{width:296px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,#e6e6e6);display:flex;flex-direction:column;min-height:0}
.kb-search{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#eee);flex:none}
.kb-search input{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#dcdcdc);background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;outline:none}
.kb-search input:focus{border-color:var(--dsw-alias-brand-primary,#4c6ef5)}
.kb-list{flex:1;min-height:0;overflow:auto;padding:6px 0 24px}
.kb-cat{padding:9px 14px 4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#777);text-transform:uppercase}
.kb-item{padding:7px 14px;cursor:pointer;border-left:2px solid transparent}
.kb-item:hover{background:var(--dsw-alias-bg-layer-1,#f5f5f5)}
.kb-item-on{background:var(--dsw-alias-bg-layer-2,#eef2ff);border-left-color:var(--dsw-alias-brand-primary,#4c6ef5)}
.kb-item-t{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kb-item-s{font-size:11px;color:var(--dsw-alias-label-secondary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.kb-empty{padding:22px 16px;color:var(--dsw-alias-label-secondary,#888);font-size:12px}
.kb-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.kb-dochead{display:flex;align-items:center;gap:9px;padding:11px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#eee);flex:none;min-height:46px}
.kb-docname{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kb-tag{font-size:10.5px;padding:2px 7px;border-radius:99px;background:var(--dsw-alias-bg-layer-2,#eef2ff);color:var(--dsw-alias-label-secondary,#556);white-space:nowrap}
.kb-docbody{flex:1;min-height:0;overflow:auto;padding:20px 26px 60px}
.kb-edit{flex:1;min-height:0;display:flex;flex-direction:column;padding:12px 18px 18px;gap:9px}
.kb-edit input,.kb-edit textarea{font:inherit;border:1px solid var(--dsw-alias-border-l1,#dcdcdc);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;outline:none;box-sizing:border-box}
.kb-edit textarea{flex:1;min-height:0;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6}
.kb-row{display:flex;gap:9px}
.kb-row input{flex:1;min-width:0}
.kb-msg{padding:8px 18px;font-size:12px;color:#c0392b;border-bottom:1px solid var(--dsw-alias-border-l1,#eee)}
.kb-msg-ok{color:#1e7f4f}
.kb-md h1{font-size:21px;margin:4px 0 14px;font-weight:650;border-bottom:1px solid var(--dsw-alias-border-l1,#eee);padding-bottom:8px}
.kb-md h2{font-size:17px;margin:24px 0 10px;font-weight:650}
.kb-md h3{font-size:14.5px;margin:19px 0 8px;font-weight:650}
.kb-md h4,.kb-md h5,.kb-md h6{font-size:13px;margin:15px 0 6px;font-weight:650}
.kb-md p{margin:9px 0}
.kb-md ul,.kb-md ol{margin:9px 0;padding-left:22px}
.kb-md li{margin:3px 0}
.kb-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);padding:1px 5px;border-radius:5px}
.kb-md pre{background:var(--dsw-alias-bg-layer-2,#f6f6f6);border:1px solid var(--dsw-alias-border-l1,#e6e6e6);border-radius:10px;padding:12px 14px;overflow:auto;margin:11px 0}
.kb-md pre code{background:none;padding:0;font-size:12px;line-height:1.6}
.kb-md blockquote{margin:11px 0;padding:2px 14px;border-left:3px solid var(--dsw-alias-border-l1,#dcdcdc);color:var(--dsw-alias-label-secondary,#555)}
.kb-md table{border-collapse:collapse;margin:12px 0;font-size:12.5px;width:100%}
.kb-md th,.kb-md td{border:1px solid var(--dsw-alias-border-l1,#e0e0e0);padding:6px 10px;text-align:left;vertical-align:top}
.kb-md th{background:var(--dsw-alias-bg-layer-2,#f5f5f5);font-weight:600}
.kb-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l1,#e6e6e6);margin:18px 0}
.kb-md a{color:var(--dsw-alias-brand-primary,#4c6ef5)}
.kb-hint{color:var(--dsw-alias-label-secondary,#888);font-size:12.5px}
`

    /* --------------------------- Markdown --------------------------- */

    function inline(text, keyBase) {
      const out = []
      const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
      let last = 0
      let m
      let i = 0
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        const tok = m[0]
        const key = keyBase + '-i' + i++
        if (tok.startsWith('`')) {
          out.push(h('code', { key }, tok.slice(1, -1)))
        } else if (tok.startsWith('**')) {
          out.push(h('strong', { key }, tok.slice(2, -2)))
        } else if (tok.startsWith('*')) {
          out.push(h('em', { key }, tok.slice(1, -1)))
        } else {
          const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
          if (mm) out.push(h('a', { key, href: mm[2], target: '_blank', rel: 'noreferrer' }, mm[1]))
          else out.push(tok)
        }
        last = m.index + tok.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    function renderMarkdown(src) {
      const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let i = 0
      let key = 0
      const nextKey = () => 'b' + key++

      while (i < lines.length) {
        const line = lines[i]

        // 围栏代码块
        if (/^```/.test(line)) {
          const lang = line.slice(3).trim()
          const buf = []
          i++
          while (i < lines.length && !/^```/.test(lines[i])) {
            buf.push(lines[i])
            i++
          }
          i++
          blocks.push(
            h('pre', { key: nextKey() }, h('code', { className: lang ? 'lang-' + lang : undefined }, buf.join('\n')))
          )
          continue
        }

        // 标题
        const hm = /^(#{1,6})\s+(.*)$/.exec(line)
        if (hm) {
          blocks.push(h('h' + hm[1].length, { key: nextKey() }, inline(hm[2], nextKey())))
          i++
          continue
        }

        // 分隔线
        if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
          blocks.push(h('hr', { key: nextKey() }))
          i++
          continue
        }

        // 表格
        if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
          const head = splitRow(line)
          i += 2
          const rows = []
          while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
            rows.push(splitRow(lines[i]))
            i++
          }
          blocks.push(
            h(
              'table',
              { key: nextKey() },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  head.map((c, ci) => h('th', { key: 'th' + ci }, inline(c, nextKey())))
                )
              ),
              h(
                'tbody',
                null,
                rows.map((r, ri) =>
                  h(
                    'tr',
                    { key: 'tr' + ri },
                    head.map((_c, ci) => h('td', { key: 'td' + ci }, inline(r[ci] || '', nextKey())))
                  )
                )
              )
            )
          )
          continue
        }

        // 引用
        if (/^\s*>\s?/.test(line)) {
          const buf = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            buf.push(lines[i].replace(/^\s*>\s?/, ''))
            i++
          }
          blocks.push(h('blockquote', { key: nextKey() }, renderMarkdown(buf.join('\n'))))
          continue
        }

        // 列表
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\.\s+/.test(line)
          const items = []
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
            i++
          }
          blocks.push(
            h(
              ordered ? 'ol' : 'ul',
              { key: nextKey() },
              items.map((t, ii) => h('li', { key: 'li' + ii }, inline(t, nextKey())))
            )
          )
          continue
        }

        // 空行
        if (line.trim() === '') {
          i++
          continue
        }

        // 段落（合并连续非空行）
        const buf = [line]
        i++
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !/^(#{1,6})\s/.test(lines[i]) &&
          !/^```/.test(lines[i]) &&
          !/^\s*>\s?/.test(lines[i]) &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
        ) {
          buf.push(lines[i])
          i++
        }
        blocks.push(h('p', { key: nextKey() }, inline(buf.join(' '), nextKey())))
      }

      return blocks
    }

    function splitRow(line) {
      let s = line.trim()
      if (s.startsWith('|')) s = s.slice(1)
      if (s.endsWith('|')) s = s.slice(0, -1)
      return s.split('|').map((c) => c.trim())
    }

    /* ---------------------------- 图标 ---------------------------- */

    function svg(size, children) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        children
      )
    }

    function PanelIcon() {
      return svg(17, [
        h('path', { key: 'a', d: 'M4 4.5h6.5v15H4z' }),
        h('path', { key: 'b', d: 'M13.5 4.5H20v15h-6.5z' }),
        h('path', { key: 'c', d: 'M6.4 8h1.8M6.4 11h1.8M15.8 8h1.8M15.8 11h1.8' }),
      ])
    }

    /* ---------------------------- 主面板 ---------------------------- */

    function App() {
      const [entries, setEntries] = React.useState([])
      const [root, setRoot] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [selected, setSelected] = React.useState('')
      const [entry, setEntry] = React.useState(null)
      const [mode, setMode] = React.useState('view')
      const [draft, setDraft] = React.useState({ title: '', tags: '', body: '', category: '' })
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const refresh = React.useCallback(async () => {
        try {
          const r = await hostCall('list')
          if (r && r.ok) {
            setEntries(r.entries || [])
            setRoot(r.root || '')
          } else {
            setMsg({ bad: true, text: (r && r.error) || '读取资料目录失败' })
          }
        } catch (e) {
          setMsg({ bad: true, text: '无法连接 Host 半边：' + e.message })
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      React.useEffect(() => {
        if (query.trim() === '') {
          setHits(null)
          return
        }
        let alive = true
        const t = setTimeout(async () => {
          try {
            const r = await hostCall('search', { q: query, limit: 60 })
            if (alive && r && r.ok) setHits(r.hits || [])
          } catch {
            /* 忽略 */
          }
        }, 180)
        return () => {
          alive = false
          clearTimeout(t)
        }
      }, [query])

      // 已拉平显示的一维列表：搜索命中时用 hits，否则用 entries
      const flat = React.useMemo(() => {
        if (hits !== null) return hits
        return entries
      }, [hits, entries])

      const grouped = React.useMemo(() => {
        const map = new Map()
        for (const e of flat) {
          const k = e.category || '(未分类)'
          if (!map.has(k)) map.set(k, [])
          map.get(k).push(e)
        }
        return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      }, [flat])

      const open = React.useCallback(async (id) => {
        setBusy(true)
        setMsg(null)
        try {
          const r = await hostCall('read', { id })
          if (r && r.ok) {
            setEntry(r.entry)
            setSelected(id)
            setMode('view')
          } else {
            setMsg({ bad: true, text: (r && r.error) || '读取失败' })
          }
        } catch (e) {
          setMsg({ bad: true, text: e.message })
        } finally {
          setBusy(false)
        }
      }, [])

      const startNew = React.useCallback(() => {
        setEntry(null)
        setSelected('')
        setDraft({ title: '', tags: '', body: '', category: '' })
        setMode('edit')
        setMsg(null)
      }, [])

      const startEdit = React.useCallback(() => {
        if (!entry) return
        setDraft({
          title: entry.title || '',
          tags: (entry.tags || []).join(', '),
          body: entry.body || '',
          category: entry.category || '',
        })
        setMode('edit')
        setMsg(null)
      }, [entry])

      const save = React.useCallback(async () => {
        setBusy(true)
        try {
          const tags = draft.tags
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter((s) => s !== '')
          const payload = {
            id: selected || undefined,
            title: draft.title,
            tags,
            body: draft.body,
            category: draft.category,
          }
          const r = await hostCall('save', payload)
          if (r && r.ok) {
            setMsg({ bad: false, text: '已保存：' + r.id })
            await refresh()
            await open(r.id)
          } else {
            setMsg({ bad: true, text: (r && r.error) || '保存失败' })
          }
        } catch (e) {
          setMsg({ bad: true, text: e.message })
        } finally {
          setBusy(false)
        }
      }, [draft, selected, refresh, open])

      const remove = React.useCallback(async () => {
        if (!selected) return
        if (typeof window !== 'undefined' && !window.confirm('删除「' + selected + '」？将移入 .trash 可恢复。')) return
        setBusy(true)
        try {
          const r = await hostCall('delete', { id: selected })
          if (r && r.ok) {
            setMsg({ bad: false, text: '已移入回收站：' + r.id })
            setEntry(null)
            setSelected('')
            setMode('view')
            await refresh()
          } else {
            setMsg({ bad: true, text: (r && r.error) || '删除失败' })
          }
        } catch (e) {
          setMsg({ bad: true, text: e.message })
        } finally {
          setBusy(false)
        }
      }, [selected, refresh])

      const head = h(
        'div',
        { className: 'kb-head' },
        h('div', { className: 'kb-title' }, h('span', { className: 'kb-dot' }), '资料库'),
        h('div', { className: 'kb-spacer' }),
        h('div', { className: 'kb-stat' }, entries.length + ' 份资料'),
        h('button', { className: 'kb-btn', onClick: refresh, disabled: busy }, '刷新'),
        h('button', { className: 'kb-btn kb-btn-primary', onClick: startNew }, '新建')
      )

      const side = h(
        'div',
        { className: 'kb-side' },
        h(
          'div',
          { className: 'kb-search' },
          h('input', {
            value: query,
            placeholder: '搜索标题 / 正文…',
            onChange: (e) => setQuery(e.target.value),
          })
        ),
        h(
          'div',
          { className: 'kb-list' },
          grouped.length === 0
            ? h('div', { className: 'kb-empty' }, query ? '没有匹配的资料' : '资料库还是空的，点右上「新建」')
            : grouped.map(([cat, list]) =>
                h(
                  'div',
                  { key: 'g-' + cat },
                  h('div', { className: 'kb-cat' }, cat),
                  list.map((e) =>
                    h(
                      'div',
                      {
                        key: e.id,
                        className: 'kb-item' + (e.id === selected ? ' kb-item-on' : ''),
                        onClick: () => void open(e.id),
                        title: e.id,
                      },
                      h('div', { className: 'kb-item-t' }, e.title || e.id),
                      h('div', { className: 'kb-item-s' }, e.snippet || e.excerpt || '')
                    )
                  )
                )
              )
        )
      )

      let docHead
      let docBody

      if (mode === 'edit') {
        docHead = h(
          'div',
          { className: 'kb-dochead' },
          h('div', { className: 'kb-docname' }, selected ? '编辑：' + selected : '新建资料'),
          h('div', { className: 'kb-spacer' }),
          h('button', { className: 'kb-btn kb-btn-primary', onClick: save, disabled: busy }, '保存'),
          h(
            'button',
            {
              className: 'kb-btn',
              onClick: () => {
                setMode('view')
                setMsg(null)
              },
              disabled: busy,
            },
            '取消'
          )
        )
        docBody = h(
          'div',
          { className: 'kb-edit' },
          h(
            'div',
            { className: 'kb-row' },
            h('input', {
              value: draft.title,
              placeholder: '标题（新建时也作为文件名）',
              onChange: (e) => setDraft({ ...draft, title: e.target.value }),
            })
          ),
          h(
            'div',
            { className: 'kb-row' },
            h('input', {
              value: draft.category,
              placeholder: '分类（即子目录，可留空；新建时可用，如 handbook）',
              onChange: (e) => setDraft({ ...draft, category: e.target.value }),
            }),
            h('input', {
              value: draft.tags,
              placeholder: '标签，逗号分隔',
              onChange: (e) => setDraft({ ...draft, tags: e.target.value }),
            })
          ),
          h('textarea', {
            value: draft.body,
            placeholder: '正文（Markdown）',
            onChange: (e) => setDraft({ ...draft, body: e.target.value }),
          })
        )
      } else if (entry) {
        docHead = h(
          'div',
          { className: 'kb-dochead' },
          h('div', { className: 'kb-docname' }, entry.title),
          (entry.tags || []).map((t, i) => h('span', { key: 'tag' + i, className: 'kb-tag' }, t)),
          h('div', { className: 'kb-spacer' }),
          h('div', { className: 'kb-stat' }, entry.id + '.md'),
          h('button', { className: 'kb-btn', onClick: startEdit }, '编辑'),
          h('button', { className: 'kb-btn kb-btn-danger', onClick: remove, disabled: busy }, '删除')
        )
        docBody = h('div', { className: 'kb-docbody kb-md' }, renderMarkdown(entry.body))
      } else {
        docHead = h('div', { className: 'kb-dochead' }, h('div', { className: 'kb-docname' }, '资料库'))
        docBody = h(
          'div',
          { className: 'kb-docbody' },
          h(
            'div',
            { className: 'kb-hint' },
            root ? '资料根目录：' + root : '正在连接 Host 半边…',
            h('br'),
            h('br'),
            '左侧选择资料阅读；会话中也可用 kb_search / kb_read 工具按需检索。'
          )
        )
      }

      return h(
        'div',
        { className: 'kb-root' },
        head,
        msg ? h('div', { className: 'kb-msg' + (msg.bad ? '' : ' kb-msg-ok') }, msg.text) : null,
        h('div', { className: 'kb-body' }, side, h('div', { className: 'kb-main' }, docHead, docBody))
      )
    }

    /* ---------------------------- 装配 ---------------------------- */

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined || slots === null) {
        console.error('[knowledge-base] slots 服务不可用')
        return
      }

      ctx.effect(() => insertStyles(CSS))

      ctx.effect(() =>
        slots.inject('sidebar.panellist', () =>
          slots.register({ name: 'sidebar.panellist', id: SLOT_ID, order: 45, label: '资料库' }, function () {
            return h(PanelIcon, null)
          })
        )
      )

      ctx.effect(() =>
        slots.inject('main', () =>
          slots.register({ name: 'main', key: SLOT_ID }, function () {
            return h(App, null)
          })
        )
      )
    }

    // __ModuleLoader__ 协议要求 factory 返回插件对象；缺少这句会让 loader
    // 拿到 undefined，报 "invalid plugin ... received undefined"。
    return module.exports
  },
})
