// Generates a clean, light-themed, text-selectable PDF of the diagnostic report.
//
// This module imports @react-pdf/renderer (a heavy, browser-oriented library), so it
// must NEVER be imported at the top level of a page — that would pull it into SSR and
// the initial bundle. Instead, import it dynamically inside a click handler:
//
//   const { downloadReportPdf } = await import('@/components/ReportPdf')
//   await downloadReportPdf(report, businessName)
//
// Design goals: reads like an official document / short report, not a screenshot.
// Positive-polarity (dark ink on warm off-white), serif body, generous line-height,
// the business name as a letterhead, and a running header + page numbers on every page.

import {
  Document, Page, Text, View, StyleSheet, pdf, Font,
} from '@react-pdf/renderer'
import type { Report, AreaScore, QuickWin, BigBet } from '@/lib/report'

// Disable hyphenation — cleaner for a business document (no mid-word breaks).
Font.registerHyphenationCallback(word => [word])

// ── Palette (light, document-grade; see the readability research) ──────────────
const PAPER = '#FBFAF7'   // warm off-white "paper"
const INK = '#2A2A28'     // body text — ~13:1 on paper, softer than pure black
const HEAD = '#1A1815'    // headings / near-black
const MUTED = '#6B675E'   // labels, captions, meta
const HAIR = '#E5E1D8'    // hairline rules
const CARD = '#F4F1EA'    // subtle callout background
const GOLD = '#C8A96E'    // brand accent — rules & the business name only
const GOLDTX = '#8A6D2F'  // darker gold that reads as text on white

// Score colors tuned for a light background (the screen versions are too light on white).
const scoreColor = (s: number) => (s <= 2 ? '#BF4A2E' : s === 3 ? '#B08900' : '#3F7E68')

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    color: INK,
    fontFamily: 'Times-Roman',
    fontSize: 11,
    lineHeight: 1.55,
    paddingTop: 64,
    paddingBottom: 56,
    paddingHorizontal: 56,
  },
  // Running header (every page), pinned to the top margin.
  runHeader: {
    position: 'absolute',
    top: 28,
    left: 56,
    right: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIR,
  },
  runHeaderName: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: HEAD, letterSpacing: 0.5 },
  runHeaderMeta: { fontFamily: 'Helvetica', fontSize: 7, color: MUTED, letterSpacing: 1 },
  // Footer (every page) with page numbers.
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 56,
    right: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontFamily: 'Helvetica',
    fontSize: 7,
    color: MUTED,
    letterSpacing: 0.5,
  },

  // First-page letterhead.
  eyebrow: { fontFamily: 'Helvetica', fontSize: 8, color: GOLDTX, letterSpacing: 3, marginBottom: 8 },
  bizName: { fontFamily: 'Times-Bold', fontSize: 30, color: HEAD, lineHeight: 1.1 },
  goldRule: { height: 2, backgroundColor: GOLD, width: 54, marginTop: 14, marginBottom: 8 },
  letterMeta: { fontFamily: 'Helvetica', fontSize: 8, color: MUTED, letterSpacing: 1 },

  // Stats row.
  statsRow: { flexDirection: 'row', marginTop: 22, marginBottom: 8 },
  stat: { marginRight: 34 },
  statNum: { fontFamily: 'Times-Bold', fontSize: 20 },
  statLabel: { fontFamily: 'Helvetica', fontSize: 7.5, color: MUTED, letterSpacing: 1, marginTop: 2 },

  // Section scaffolding.
  sectionLabel: {
    fontFamily: 'Helvetica-Bold', fontSize: 9, color: GOLDTX, letterSpacing: 2,
    marginTop: 26, marginBottom: 10,
  },
  sectionRule: { height: 0.5, backgroundColor: HAIR, marginBottom: 14 },

  summary: { fontSize: 12, lineHeight: 1.7, color: INK },

  // Area cards.
  area: { marginBottom: 16 },
  areaTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  areaName: { fontFamily: 'Times-Bold', fontSize: 13, color: HEAD },
  areaLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, letterSpacing: 0.5 },
  barTrack: { height: 5, backgroundColor: HAIR, borderRadius: 2.5, marginBottom: 10 },
  barFill: { height: 5, borderRadius: 2.5 },
  fieldLabel: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: MUTED, letterSpacing: 1.5, marginBottom: 3 },
  fieldText: { fontSize: 10.5, lineHeight: 1.55, color: INK, marginBottom: 8 },
  callout: { backgroundColor: CARD, borderLeftWidth: 2, borderLeftColor: '#3F7E68', paddingVertical: 8, paddingHorizontal: 11, borderRadius: 3 },
  calloutLabel: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#3F7E68', letterSpacing: 1.5, marginBottom: 3 },
  calloutText: { fontSize: 10.5, lineHeight: 1.55, color: INK },

  // Quick wins.
  win: { marginBottom: 13, paddingBottom: 13, borderBottomWidth: 0.5, borderBottomColor: HAIR },
  winTitle: { fontFamily: 'Times-Bold', fontSize: 12, color: HEAD, marginBottom: 4 },
  winDesc: { fontSize: 10.5, lineHeight: 1.55, color: INK, marginBottom: 6 },
  meterRow: { flexDirection: 'row' },
  meter: { flexDirection: 'row', alignItems: 'center', marginRight: 22 },
  meterLabel: { fontFamily: 'Helvetica', fontSize: 7.5, color: MUTED, letterSpacing: 0.5, marginRight: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 3 },

  // Big bets.
  bet: { marginBottom: 15 },
  betTitle: { fontFamily: 'Times-Bold', fontSize: 13, color: HEAD, marginBottom: 4 },
  betDesc: { fontSize: 10.5, lineHeight: 1.55, color: INK, marginBottom: 7 },
  mvp: { backgroundColor: CARD, borderLeftWidth: 2, borderLeftColor: GOLD, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 3 },
  mvpLabel: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: GOLDTX, letterSpacing: 1.5, marginBottom: 3 },
  mvpText: { fontSize: 10.5, lineHeight: 1.55, color: INK },
})

function Dots({ value, color }: { value: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3].map(n => (
        <View key={n} style={[styles.dot, { backgroundColor: n <= value ? color : HAIR }]} />
      ))}
    </View>
  )
}

function AreaBlock({ area }: { area: AreaScore }) {
  const color = scoreColor(area.score)
  return (
    <View style={styles.area} wrap={false}>
      <View style={styles.areaTop}>
        <Text style={styles.areaName}>{area.category}</Text>
        <Text style={[styles.areaLabel, { color }]}>{area.label}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${(area.score / 5) * 100}%`, backgroundColor: color }]} />
      </View>
      {area.insight ? (
        <>
          <Text style={styles.fieldLabel}>FINDING</Text>
          <Text style={styles.fieldText}>{area.insight}</Text>
        </>
      ) : null}
      {area.opportunity ? (
        <View style={styles.callout}>
          <Text style={styles.calloutLabel}>OPPORTUNITY</Text>
          <Text style={styles.calloutText}>{area.opportunity}</Text>
        </View>
      ) : null}
    </View>
  )
}

export function ReportDocument({ report, businessName }: { report: Report; businessName: string }) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const areas = [...(report.areas ?? [])].sort((a, b) => a.score - b.score)
  const quickWins = report.quickWins ?? []
  const bigBets = report.bigBets ?? []
  const criticalCount = areas.filter(a => a.score <= 2).length
  const name = businessName || 'Your Business'

  const stats: [string, number, string][] = [
    ['Areas Reviewed', areas.length, HEAD],
    ['Critical Gaps', criticalCount, '#BF4A2E'],
    ['Quick Wins', quickWins.length, '#3F7E68'],
  ]

  return (
    <Document title={`${name} — Diagnostic Report`} author="Pocket CMO">
      <Page size="A4" style={styles.page}>
        {/* Running header + footer repeat on every page */}
        <View style={styles.runHeader} fixed>
          <Text style={styles.runHeaderName}>{name.toUpperCase()}</Text>
          <Text style={styles.runHeaderMeta}>DIAGNOSTIC REPORT</Text>
        </View>
        <View style={styles.footer} fixed>
          <Text>POCKET CMO</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        {/* Letterhead (first page) */}
        <Text style={styles.eyebrow}>DIAGNOSTIC REPORT</Text>
        <Text style={styles.bizName}>{name}</Text>
        <View style={styles.goldRule} />
        <Text style={styles.letterMeta}>{`PREPARED ${today.toUpperCase()}`}</Text>

        <View style={styles.statsRow}>
          {stats.map(([label, num, color]) => (
            <View key={label} style={styles.stat}>
              <Text style={[styles.statNum, { color }]}>{num}</Text>
              <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {/* Overview */}
        {report.summary ? (
          <>
            <Text style={styles.sectionLabel}>OVERVIEW</Text>
            <View style={styles.sectionRule} />
            <Text style={styles.summary}>{report.summary}</Text>
          </>
        ) : null}

        {/* Area breakdown */}
        {areas.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>AREA BREAKDOWN</Text>
            <View style={styles.sectionRule} />
            {areas.map((a, i) => <AreaBlock key={i} area={a} />)}
          </>
        ) : null}

        {/* Quick wins */}
        {quickWins.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>QUICK WINS — DO THESE FIRST</Text>
            <View style={styles.sectionRule} />
            {quickWins.map((w: QuickWin, i) => (
              <View key={i} style={styles.win} wrap={false}>
                <Text style={styles.winTitle}>{w.title}</Text>
                <Text style={styles.winDesc}>{w.desc}</Text>
                <View style={styles.meterRow}>
                  <View style={styles.meter}>
                    <Text style={styles.meterLabel}>EFFORT</Text>
                    <Dots value={w.effort} color="#BF4A2E" />
                  </View>
                  <View style={styles.meter}>
                    <Text style={styles.meterLabel}>IMPACT</Text>
                    <Dots value={w.impact} color="#3F7E68" />
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {/* Big bets */}
        {bigBets.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>BIG BETS — VALIDATE BEFORE BUILDING</Text>
            <View style={styles.sectionRule} />
            {bigBets.map((b: BigBet, i) => (
              <View key={i} style={styles.bet} wrap={false}>
                <Text style={styles.betTitle}>{b.title}</Text>
                <Text style={styles.betDesc}>{b.desc}</Text>
                {b.mvp ? (
                  <View style={styles.mvp}>
                    <Text style={styles.mvpLabel}>MVP PATH</Text>
                    <Text style={styles.mvpText}>{b.mvp}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </Page>
    </Document>
  )
}

// Builds the PDF and triggers a browser download. Call from a click handler.
export async function downloadReportPdf(report: Report, businessName: string) {
  const blob = await pdf(<ReportDocument report={report} businessName={businessName} />).toBlob()
  const url = URL.createObjectURL(blob)
  const safeName = (businessName || 'business').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName || 'business'}-diagnostic-report.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
