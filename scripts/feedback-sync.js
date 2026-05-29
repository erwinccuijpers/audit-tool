#!/usr/bin/env node
/**
 * feedback-sync.js
 *
 * Usage:
 *   node scripts/feedback-sync.js              → fetch & write Obsidian inbox
 *   node scripts/feedback-sync.js --resolve <id> ["note"]  → mark reviewed + optional note
 *
 * Writes to: ~/Desktop/Claude workspace/Pocket CMO — Feedback Inbox.md
 */

const https = require('https')
const fs = require('fs')
const path = require('path')

// Load .env.local manually (no dotenv dependency)
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OBSIDIAN_PATH = path.join(process.env.HOME, 'Desktop/Claude workspace/Pocket CMO — Feedback Inbox.md')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE env vars. Check .env.local')
  process.exit(1)
}

function sbFetch(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + endpoint)
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || '',
        ...options.headers,
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    if (options.body) req.write(JSON.stringify(options.body))
    req.end()
  })
}

async function fetchFeedback() {
  const res = await sbFetch(
    '/rest/v1/feedback?select=*,sessions(business_name,business_type,industry,status)&order=reviewed.asc,created_at.desc'
  )
  if (res.status !== 200) throw new Error('Supabase error: ' + JSON.stringify(res.body))
  return res.body
}

async function markReviewed(id, note) {
  const body = { reviewed: true }
  if (note) body.resolution_note = note
  const res = await sbFetch(`/rest/v1/feedback?id=eq.${id}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body,
  })
  if (res.status !== 200 && res.status !== 204) throw new Error('Update failed: ' + JSON.stringify(res.body))
  console.log(`✓ Marked ${id} as reviewed${note ? ' — "' + note + '"' : ''}`)
}

function formatItem(f) {
  const session = Array.isArray(f.sessions) ? f.sessions[0] : f.sessions
  const snap = f.session_snapshot || {}
  const ctx = f.error_context || {}
  const businessName = snap.business_name || session?.business_name || 'Anonymous'
  const businessType = snap.business_type || session?.business_type || '?'
  const industry = session?.industry || '?'
  const resumeLink = f.session_id ? `https://pocketcmo.pro/?resume=${f.session_id}` : null
  const date = new Date(f.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const emoji = f.feedback_type === 'bug' ? '🐛' : '💬'
  const status = f.reviewed ? '~~resolved~~' : '**open**'

  let md = `\n---\n\n`
  md += `### ${emoji} ${businessName} — ${f.category || f.feedback_type} · ${date}\n`
  md += `> ID: \`${f.id}\`  ·  Status: ${status}\n\n`

  if (f.user_email) md += `- **Email:** [${f.user_email}](mailto:${f.user_email})\n`
  if (resumeLink) md += `- **Resume link:** ${resumeLink}\n`
  md += `- **Business:** ${businessName} · ${businessType} · ${industry}\n`
  if (snap.answered_count != null) md += `- **Progress:** ${snap.answered_count} questions answered\n`
  if (ctx.currentQuestion) md += `- **Question at time:** ${ctx.currentQuestion}${ctx.currentQuestionText ? ` — "${ctx.currentQuestionText}"` : ''}\n`
  if (ctx.phase) md += `- **Phase:** ${ctx.phase}\n`

  md += `\n**Feedback:**\n> ${f.feedback_text?.trim().replace(/\n/g, '\n> ')}\n`

  if (f.recommendation) {
    md += `\n**Re recommendation:**\n> ${f.recommendation.slice(0, 200)}${f.recommendation.length > 200 ? '…' : ''}\n`
  }

  if (f.ai_summary) {
    md += `\n**AI Analysis:**\n\`\`\`\n${f.ai_summary}\n\`\`\`\n`
  } else {
    md += `\n*AI analysis pending — run \`node scripts/feedback-sync.js\` again in ~30s*\n`
  }

  if (ctx.conversationSnippet?.length > 0) {
    md += `\n<details><summary>Last messages in session</summary>\n\n`
    ctx.conversationSnippet.forEach(m => {
      md += `**[${m.role}]** ${String(m.content).slice(0, 200)}\n\n`
    })
    md += `</details>\n`
  }

  if (f.reviewed && f.resolution_note) {
    md += `\n✅ **Resolved:** ${f.resolution_note}\n`
  }

  if (!f.reviewed) {
    md += `\n> To resolve: \`node scripts/feedback-sync.js --resolve ${f.id} "your note"\`\n`
  }

  return md
}

async function writeInbox(items) {
  const open = items.filter(f => !f.reviewed)
  const done = items.filter(f => f.reviewed)
  const now = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  let md = `# Pocket CMO — Feedback Inbox\n\n`
  md += `> Last updated: ${now}  ·  ${open.length} open · ${done.length} resolved\n`
  md += `> Refresh: \`node /Users/erwincuijpers/audit-tool/scripts/feedback-sync.js\`\n`
  md += `> Resolve: \`node /Users/erwincuijpers/audit-tool/scripts/feedback-sync.js --resolve <id> "note"\`\n`

  md += `\n## 🔴 Open (${open.length})\n`
  if (open.length === 0) md += `\n*Nothing open — all clear.*\n`
  else open.forEach(f => { md += formatItem(f) })

  md += `\n\n## ✅ Resolved (${done.length})\n`
  if (done.length === 0) md += `\n*No resolved items yet.*\n`
  else done.forEach(f => { md += formatItem(f) })

  fs.writeFileSync(OBSIDIAN_PATH, md, 'utf8')
  console.log(`✓ Wrote ${items.length} items to:\n  ${OBSIDIAN_PATH}`)
  console.log(`  ${open.length} open · ${done.length} resolved`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args[0] === '--resolve') {
    const id = args[1]
    const note = args[2] || ''
    if (!id) { console.error('Usage: --resolve <feedback-id> ["resolution note"]'); process.exit(1) }
    await markReviewed(id, note)
    // Refresh inbox after resolving
    const items = await fetchFeedback()
    await writeInbox(items)
    return
  }

  console.log('Fetching feedback from Supabase…')
  const items = await fetchFeedback()
  await writeInbox(items)
}

main().catch(e => { console.error(e.message); process.exit(1) })
