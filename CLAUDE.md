# Pocket CMO — Audit Tool

## What this is
A structured business diagnostic interview tool that helps small business owners uncover underleveraged assets — scheduling gaps, margin blindspots, data silos, and similar hidden opportunities. The tool conducts a real conversation (not a form), builds a profile of the business, then generates a report.

**Live URL:** https://audit-tool-smoky-three.vercel.app
**GitHub:** https://github.com/erwinccuijpers/audit-tool
**Owner:** Erwin Cuijpers

---

## Tech stack
- **Frontend + API routes:** Next.js (App Router), deployed on Vercel
- **AI:** Anthropic API — `claude-sonnet-4-6`
- **Database:** Supabase (questions, sessions, responses tables)
- **Styling:** Inline styles, dark theme (`#0C0C09` background, `#C8A96E` gold accent)

---

## Architecture

### Interview flow
1. **Start** — user enters business name
2. **Intro** — 2-turn free-form conversation to understand the business
3. **Classify** — `/api/classify` analyses the intro and builds a `BusinessProfile` (type, industry, awareness level, tone, skip list, emphasis areas)
4. **Interview** — works through filtered questions from Supabase `questions` table; each question has follow-ups and a tool note
5. **Done** — redirects to `/results?session=<id>` for the report

### API routes
- `/api/classify` — takes intro conversation, returns BusinessProfile
- `/api/precheck` — checks if an upcoming question is already covered by prior summaries (skips if so)
- `/api/interview` — drives each question turn; returns follow-up or `COMPLETE`
- `/api/report` — generates the final diagnostic report from all session data

### Key logic
- `completedSummaries` — rolling array of `{question, summary}` passed as context to each API call (avoids sending full conversation history)
- `BusinessProfile` — personalises question filtering, skipping, and Claude's tone
- `COMPLETE` signal — when Claude decides a topic is exhausted, it returns only the word `COMPLETE`; the frontend moves to the next question
- Questions are stored in Supabase with `applies_to`, `follow_ups`, and `sort_order` fields

### Supabase tables
- `questions` — the question bank (with follow_ups joined)
- `sessions` — one row per interview, stores business profile and status
- `responses` — one row per question per session, stores the conversation array

---

## Key decisions (don't relitigate these)
- **No quick scan mode** — rejected because users go superficial then drop off. Go deep from the start.
- **Rolling summaries instead of full history** — prevents token bloat; each API call gets a condensed context block, not the entire conversation
- **max_tokens: 400 on interview route** — keeps responses tight and conversational
- **`COMPLETE` as a signal** — cleaner than parsing sentiment; Claude decides when a topic is done
- **Inline styles throughout** — intentional, keeps the dark theme self-contained without CSS conflicts
- **Hints/tips in the conversation** — Claude delivers immediate value mid-interview; this is a differentiator, keep it

---

## What's been built and works
- Full multi-phase interview (intro → classify → save-prompt → interview → report)
- Business profiling and question filtering
- Rolling context summaries
- Precheck skip logic (skips questions already covered organically)
- Error handling with retry button
- Progress bar
- Results page
- Supabase persistence (sessions + responses)
- **Auth (Supabase email + password)** — account creation on save-prompt screen, sign in to resume
- **Save & resume** — session state (current_q_index, completed_summaries) persisted to Supabase after each question; full chat history restored on resume by loading saved response conversations
- **Forgot password** — reset link via email, password update screen on return
- **Category flow strip** — deduped category pills below header, highlights current area, checks off completed ones
- **"✓ saving" badge** in header when user is logged in
- **Document-grade PDF export** — `src/components/ReportPdf.tsx` builds a light-themed, text-selectable PDF via `@react-pdf/renderer` (NOT a screenshot of the dark page). Letterhead with business name + running header + page numbers on every page; reuses the existing `Report` data. Imported *dynamically* from the results page (`await import('@/components/ReportPdf')`) so the heavy lib never hits SSR/initial bundle. Light-theme palette + readability rationale chosen deliberately (positive polarity, warm off-white #FBFAF7, charcoal ink #2A2A28, gold kept as accent only). Falls back to `window.print()` if generation throws.
- Live at **pocketcmo.pro**, code on GitHub at erwinccuijpers/audit-tool

---

## Supabase schema additions (beyond defaults)
Sessions table extra columns:
- `user_id` uuid — links session to auth user
- `current_q_index` integer default 0 — which question to resume at
- `completed_summaries` jsonb default '[]' — rolling summary array for context

Auth: email + password, email confirmation disabled, Site URL set to https://pocketcmo.pro

## What's actively being built next
See `_RAW_IDEAS.md` in Erwin's Obsidian vault at:
`/Users/erwincuijpers/Desktop/ErwinsVault/ErwinsVault/MVPs/_RAW_IDEAS.md`

Current Next Up priority order:
1. In-between progress report (gap analysis as re-engagement hook)
2. Upfront framing / "reality check" intro screen (partially done via save-prompt)

---

## Before making any changes — BACKUP PROTOCOL

**Before starting any non-trivial change, create a git tag as a restore point:**

```bash
cd /Users/erwincuijpers/audit-tool
git add -A && git commit -m "snapshot: before <describe what you're about to build>"
git tag -a v-snapshot-<short-description> -m "<describe current working state>"
git push origin --tags
```

This creates a named restore point on GitHub. If anything breaks, roll back with:
```bash
git checkout v-snapshot-<name>
```

The live URL always reflects the latest push to `main`. Tags are safety nets, not deployments.

---

## After validating any update — CLAUDE.md UPDATE REMINDER

**After finishing and testing a change, update this file before closing the session:**
- Move completed items from "What's actively being built next" to the "What's been built" section
- Update architecture notes if anything structural changed
- Note any new key decisions and why they were made

This keeps future sessions fully loaded without needing to re-explain the project.
