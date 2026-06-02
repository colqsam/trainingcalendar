import { useEffect, useMemo, useState, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, ComposedChart, Line, Area, ReferenceLine, Legend,
} from 'recharts'
import { loadPlan, loadActivities, loadDecoupling, loadProjectionConfig, loadRaceConfig } from './api'
import {
  buildSessions, weeklyVolume, adherence, currentSeq, trainingLoad,
  projection, paceSeries, fmtPace, fmtClock, fmtDuration,
  crossTrainWeekly, crossTrainTotals, activityLog, extraRuns,
  projectionTimeline, groupType, TYPE_COLOR,
  momentumSeries, courseAdjust, ghostRace, distanceAtTime,
  briefSignals, localBrief,
} from './lib/compare'

const DAY_MONTH = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const hrText = (t) => (!t ? '—' : t.min ? `${t.min}–${t.max}` : `<${t.max}`)
const paceTick = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const VERDICT_COLOR = { in: '#2e7d52', over: '#c0492b', under: '#b07410' }
const STATUS_TEXT = {
  ok: 'In the sweet spot — load is well matched to your recent base.',
  caution: 'Ramping a little quick — hold steady rather than adding more.',
  high: 'Load is climbing fast relative to your base — ease off to protect the knee.',
  detrain: 'Below your recent base — fine for a down week, watch for fitness slipping.',
  baseline: 'Still building a baseline — not enough recent volume for a reliable ratio yet.',
}

// "Read of the week" — connects signals across panels into a plain-language
// brief. Tries the Claude API for a natural narrative; falls back to the
// deterministic localBrief so it always says something useful.
function WeeklyBrief({ signals }) {
  const [aiLines, setAiLines] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | done | fallback
  const fallback = useMemo(() => localBrief(signals), [signals])

  async function generate() {
    if (!signals) return
    setState('loading'); setAiLines(null)
    const prompt = `You are a sharp, calm running coach writing this week's read for an athlete's training dashboard. Use ONLY the data below. Write 3-4 short sentences, plain and direct, no bullet points, no headers, no preamble. Connect signals that relate (e.g. high momentum + high load = caution). The athlete's knee tendinitis is RESOLVED through home rehab and is NOT a current concern — do not raise it as a risk; the real open question is aerobic durability past their longest run so far. Be honest, not cheerleading.

DATA (JSON):
${JSON.stringify(signals, null, 2)}

Write the read now, as direct prose addressed to the athlete ("you").`
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
      })
      const data = await res.json()
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      if (text) {
        setAiLines(text.split(/\n+/).filter(Boolean))
        setState('done')
      } else { setState('fallback') }
    } catch {
      setState('fallback')
    }
  }

  const lines = state === 'done' && aiLines ? aiLines : fallback
  return (
    <div className="block">
      <h2 className="sec-h">This week's read</h2>
      <div className="panel brief-panel">
        <div className="brief-body">
          {lines.length ? lines.map((l, i) => <p key={i}>{l}</p>) : <p style={{ color: 'var(--muted)' }}>Log a couple of weeks of runs and the weekly read will appear here.</p>}
        </div>
        <div className="brief-foot">
          <button className="ghost-btn primary" onClick={generate} disabled={state === 'loading' || !signals}>
            {state === 'loading' ? 'Reading your week…' : state === 'done' ? 'Refresh read' : 'Generate AI read'}
          </button>
          <span className="brief-note">
            {state === 'done' ? 'Written by Claude from your live data.' : state === 'fallback' ? 'AI unavailable — showing the data-driven read.' : 'Tap for a Claude-written narrative, or read the data-driven version above.'}
          </span>
        </div>
      </div>
    </div>
  )
}

// Animated race-day simulation: your projected splits vs an even goal-pace ghost.
function GhostRunner({ race, goalSec, projSec, decouplingPct }) {
  const dist = (race && race.distance_km) || 42.195
  const model = useMemo(() => ghostRace(goalSec, projSec, decouplingPct, dist), [goalSec, projSec, decouplingPct, dist])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(120) // sim-seconds per real-second
  const raf = useRef(null)
  const last = useRef(null)
  const maxT = Math.max(model.youFinish, model.ghostFinish)

  useEffect(() => {
    if (!playing) return
    const step = (ts) => {
      if (last.current == null) last.current = ts
      const dt = (ts - last.current) / 1000
      last.current = ts
      setT((prev) => {
        const next = prev + dt * speed
        if (next >= maxT) { setPlaying(false); return maxT }
        return next
      })
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf.current); last.current = null }
  }, [playing, speed, maxT])

  const youKm = distanceAtTime(model.splits, t, 'you')
  const ghostKm = distanceAtTime(model.splits, t, 'ghost')
  const youDone = youKm >= dist, ghostDone = ghostKm >= dist
  const W = 100
  const pct = (km) => (km / dist) * W
  const gapSec = (() => {
    // time gap at current leader's position: how far apart on the road, in seconds of ghost pace
    const lead = Math.max(youKm, ghostKm)
    const trail = Math.min(youKm, ghostKm)
    return Math.round(((lead - trail) / dist) * model.ghostFinish)
  })()
  const youAhead = youKm >= ghostKm

  const reset = () => { setPlaying(false); setT(0); last.current = null }

  return (
    <div>
      <div className="ghost-controls">
        <button className="ghost-btn primary" onClick={() => { if (t >= maxT) reset(); setPlaying((p) => !p) }}>
          {playing ? 'Pause' : t > 0 && t < maxT ? 'Resume' : 'Run the race'}
        </button>
        <button className="ghost-btn" onClick={reset}>Restart</button>
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>speed</span>
        {[60, 120, 300].map((s) => (
          <span key={s} className={`speed-seg ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s === 60 ? '1×' : s === 120 ? '2×' : '5×'}</span>
        ))}
        <input type="range" min="0" max={maxT} value={Math.round(t)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }} style={{ flex: 1, minWidth: 120, accentColor: 'var(--accent)' }} />
      </div>

      <div className="ghost-readout">
        <span className="r">Clock<b>{fmtClock(t)}</b></span>
        <span className="r">You<b style={{ color: 'var(--accent)' }}>{youKm.toFixed(1)} km{youDone ? ' ✓' : ''}</b></span>
        <span className="r">Goal ghost<b style={{ color: 'var(--muted)' }}>{ghostKm.toFixed(1)} km{ghostDone ? ' ✓' : ''}</b></span>
        <span className="r">{youAhead ? 'You lead by' : 'Ghost leads by'}<b style={{ color: youAhead ? 'var(--good)' : 'var(--over)' }}>{fmtClock(gapSec)}</b></span>
      </div>

      <div className="ghost-stage">
        <svg viewBox="0 0 100 26" width="100%" preserveAspectRatio="none" style={{ display: 'block', height: 90 }}>
          {/* road */}
          <rect x="0" y="11" width="100" height="4" fill="var(--line)" rx="2" />
          {/* wall marker */}
          <line x1={pct(model.wallKm)} y1="6" x2={pct(model.wallKm)} y2="20" stroke="var(--under)" strokeWidth="0.3" strokeDasharray="0.8 0.8" />
          {/* finish */}
          <line x1={W} y1="5" x2={W} y2="21" stroke="var(--good)" strokeWidth="0.4" />
          {/* ghost dot */}
          <circle cx={pct(ghostKm)} cy="13" r="1.5" fill="#a89f90" />
          {/* you dot */}
          <circle cx={pct(youKm)} cy="13" r="1.9" fill="#e8431b" />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
          <span>0 km</span>
          <span style={{ color: 'var(--under)' }}>↑ the wall · {model.wallKm} km</span>
          <span style={{ color: 'var(--good)' }}>{dist.toFixed(1)} km</span>
        </div>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '14px 2px 0' }}>
        The ghost holds even {fmtClock(goalSec)} goal pace start to finish. You start a touch quicker, then fade through the back third — a {model.fadePct}% positive split scaled from your measured decoupling, with the wall marked at {model.wallKm} km. Projected finishes: <b style={{ color: 'var(--accent)' }}>you {fmtClock(model.youFinish)}</b> vs <b style={{ color: 'var(--muted)' }}>ghost {fmtClock(model.ghostFinish)}</b>. Where the orange dot slips behind is exactly where race-day pacing and fuel matter most.
      </p>
    </div>
  )
}

export default function App() {
  const [plan, setPlan] = useState(null)
  const [activities, setActivities] = useState([])
  const [actError, setActError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [deco, setDeco] = useState(null)
  const [projCfg, setProjCfg] = useState(null)
  const [raceCfg, setRaceCfg] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [sel, setSel] = useState(null)
  const todayISO = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    loadPlan().then((p) => { setPlan(p); setSel(currentSeq(p, todayISO)) }).catch((e) => setLoadErr(e.message))
    loadActivities().then((r) => { setActivities(r.activities); if (r.error) setActError(r.error); if (r.fetchedAt) setFetchedAt(r.fetchedAt) })
    loadDecoupling().then((r) => setDeco(r))
    loadProjectionConfig().then((c) => setProjCfg(c))
    loadRaceConfig().then((c) => setRaceCfg(c))
  }, [])

  const sessions = useMemo(() => (plan ? buildSessions(plan, activities, todayISO) : []), [plan, activities])
  const weekly = useMemo(() => (plan ? weeklyVolume(plan, sessions, activities) : []), [plan, sessions, activities])
  const stats = useMemo(() => adherence(sessions), [sessions])
  const load = useMemo(() => trainingLoad(activities, todayISO), [activities])
  const pace = useMemo(() => paceSeries(sessions), [sessions])
  const ctWeekly = useMemo(() => (plan ? crossTrainWeekly(plan, activities) : { rows: [], types: [] }), [plan, activities])
  const ctTotals = useMemo(() => crossTrainTotals(activities), [activities])
  const log = useMemo(() => activityLog(sessions, activities, 50), [sessions, activities])
  const extras = useMemo(() => extraRuns(sessions, activities), [sessions, activities])
  const projTimeline = useMemo(() => projectionTimeline(plan, activities, projCfg, todayISO), [plan, activities, projCfg])
  const momentum = useMemo(() => (plan ? momentumSeries(plan, sessions, activities, todayISO) : { points: [], current: null }), [plan, sessions, activities])

  if (!plan) return (
    <div className="wrap">
      {loadErr ? (
        <div className="banner" style={{ marginTop: 60 }}>
          <strong>Couldn’t load the plan.</strong> {loadErr}<br /><br />
          This usually means <code>public/plan.json</code> in your repo got overwritten with the wrong file’s contents during upload. Re-upload <code>plan.json</code> from the zip (it should start with <code>[</code> and a list of session objects), then redeploy.
        </div>
      ) : (
        <p style={{ marginTop: 60 }}>Loading plan…</p>
      )}
    </div>
  )

  const seqs = [...new Set(plan.map((p) => p.seq))].sort((a, b) => a - b)
  const minSeq = seqs[0], maxSeq = seqs[seqs.length - 1]
  const baseN = Math.max(0, ...plan.filter((p) => p.phase === 'Base').map((p) => p.week))
  const buildN = Math.max(0, ...plan.filter((p) => p.phase === 'Build').map((p) => p.week))
  const runs = plan.filter((p) => p.is_run)
  const totalKm = Math.round(runs.reduce((t, r) => t + (r.distance_km || 0), 0))
  const peakLong = Math.max(...runs.map((r) => r.distance_km || 0))
  const mpSession = plan.find((p) => p.type === 'Pace Run' && p.pace_target)
  const mpSec = mpSession ? mpSession.pace_target.min_sec : null
  const mp = mpSec ? fmtPace(mpSec) : null
  const proj = projection(activities, mpSec, todayISO)
  const planStart = plan[0].date, planEnd = plan[plan.length - 1].date
  const daysToStart = Math.ceil((new Date(planStart) - new Date(todayISO)) / 86400000)

  const curSeq = currentSeq(plan, todayISO)
  const curLabel = (plan.find((p) => p.seq === curSeq) || {}).week_label
  const curRuns = sessions.filter((s) => s.seq === curSeq && s.is_run)
  const curWeekVol = weekly.find((w) => w.seq === curSeq)
  const curDoneKm = curWeekVol ? curWeekVol.actual : 0
  const curPlanKm = curRuns.reduce((t, s) => t + (s.distance_km || 0), 0)
  const curDone = curRuns.filter((s) => s.status === 'done').length

  const selSessions = sessions.filter((s) => s.seq === sel).sort((a, b) => a.date.localeCompare(b.date))
  const selMeta = selSessions[0] || {}
  const isStepback = selSessions.some((s) => s.stepback)
  const isTaper = selSessions.some((s) => s.taper)
  const recentDone = sessions.filter((s) => s.status === 'done').slice(-10).reverse()
  const raceRow = projTimeline.length ? projTimeline[projTimeline.length - 1] : null
  const raceProj = raceRow && raceRow.proj ? raceRow : null
  const courseAdj = raceProj ? courseAdjust(raceProj.proj, raceCfg) : null
  const momoColor = (v) => (v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--under)' : 'var(--over)')
  const decoRunsForBrief = (deco && deco.runs ? deco.runs : []).filter((r) => r.decoupling != null)
  const signals = briefSignals({
    plan, sessions, activities, todayISO, load, momentum,
    decoRuns: decoRunsForBrief, proj, courseAdj, raceCfg, mpSec,
  })

  const zoneData = [
    { name: 'In zone', value: stats.hrInZone, color: '#2e7d52' },
    { name: 'Ran hot', value: stats.hrOver, color: '#c0492b' },
    { name: 'Very easy', value: stats.hrUnder, color: '#b07410' },
  ].filter((d) => d.value > 0)

  const paceDomain = (() => {
    if (!pace.length) return [300, 480]
    const vals = pace.flatMap((d) => [d.band[0], d.band[1], d.actual])
    return [Math.floor((Math.min(...vals) - 15) / 5) * 5, Math.ceil((Math.max(...vals) + 15) / 5) * 5]
  })()
  const renderDot = (props) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    return <circle cx={cx} cy={cy} r={4.5} fill={VERDICT_COLOR[payload.verdict] || '#2e7d52'} stroke="#fcfaf5" strokeWidth={1.5} />
  }

  const decoRuns = (deco && deco.runs ? deco.runs : []).filter((r) => r.decoupling != null)
  const decoColor = (d) => (d < 5 ? '#2e7d52' : d < 10 ? '#b07410' : '#c0492b')

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">{baseN}-week base → {buildN}-week marathon build{mp ? ` · goal pace ${mp}` : ''}</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
          <h1>Plan&nbsp;vs&nbsp;Actual</h1>
          <div className="weekflag">
            {daysToStart > 0
              ? <><div className="num" style={{ color: 'var(--accent)' }}>STARTS IN</div><div className="big num">{daysToStart} days</div></>
              : <><div className="num" style={{ color: 'var(--muted)' }}>CURRENTLY</div><div className="big num">{curLabel}</div></>}
          </div>
        </div>
        <div className="meta-strip">
          <span>Block<b className="num">{DAY_MONTH(planStart)} – {DAY_MONTH(planEnd)}</b></span>
          <span>Planned volume<b className="num">{totalKm} km</b></span>
          <span>Runs in plan<b className="num">{runs.length}</b></span>
          <span>Peak long run<b className="num">{peakLong} km</b></span>
        </div>
      </header>

      {actError && (
        <div className="banner">
          Showing your plan only — Strava isn’t wired up yet. Set <code>STRAVA_CLIENT_ID</code> / <code>STRAVA_CLIENT_SECRET</code>, visit <a href="/.netlify/functions/strava-auth">/.netlify/functions/strava-auth</a> to authorize, then set <code>STRAVA_REFRESH_TOKEN</code> and redeploy.
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <p className="label">{curLabel} — this week</p>
          <div className="val num">{curDone}<small> / {curRuns.length} runs</small></div>
          <p className="sub">{Math.round(curDoneKm)} of {Math.round(curPlanKm)} km logged</p>
        </div>
        <div className="kpi">
          <p className="label">Plan completion</p>
          <div className="val num">{stats.completionRate == null ? '—' : `${stats.completionRate}%`}</div>
          <p className="sub">{stats.completed} done · {stats.missed} missed</p>
        </div>
        <div className="kpi">
          <p className="label">Runs in HR zone</p>
          <div className="val num" style={{ color: 'var(--good)' }}>{stats.zoneRate == null ? '—' : `${stats.zoneRate}%`}</div>
          <p className="sub">{stats.hrInZone} of {stats.hrRated} rated runs</p>
        </div>
        <div className="kpi">
          <p className="label">Logged distance</p>
          <div className="val num">{Math.round(weekly.reduce((t, w) => t + w.actual, 0))}<small> km</small></div>
          <p className="sub">actual run volume so far</p>
        </div>
      </div>

      <WeeklyBrief signals={signals} />

      {/* Momentum */}
      <div className="block">
        <h2 className="sec-h">Momentum</h2>
        <div className="panel">
          {momentum.current != null ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 1.3fr', gap: 24, alignItems: 'center' }}>
              <div>
                <div className="momentum-head">
                  <span className="momentum-score" style={{ color: momoColor(momentum.current) }}>{momentum.current}</span>
                  <span className={`momentum-arrow ${momentum.delta > 1 ? 'mo-up' : momentum.delta < -1 ? 'mo-down' : 'mo-flat'}`}>
                    {momentum.delta == null ? '—' : momentum.delta > 1 ? `▲ +${momentum.delta}` : momentum.delta < -1 ? `▼ ${momentum.delta}` : '▬ steady'}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                  out of 100 · {momentum.delta > 1 ? 'trending up' : momentum.delta < -1 ? 'cooling off' : 'holding steady'} vs last week
                </p>
                {momentum.parts && (
                  <div className="mo-bars">
                    {[['Consistency', momentum.parts.consistency, '#e8431b'], ['Efficiency', momentum.parts.efficiency, '#2e7d52'], ['Load health', momentum.parts.load, '#7f77dd']].map(([lbl, val, c]) => (
                      <div className="mo-bar-row" key={lbl}>
                        <span className="lbl">{lbl}</span>
                        <span className="mo-bar-track"><span className="mo-bar-fill" style={{ width: `${val}%`, background: c }} /></span>
                        <span className="pct">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ width: '100%', height: 180 }}>
                <ResponsiveContainer>
                  <ComposedChart data={momentum.points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="mofill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e8431b" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#e8431b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e4dccd" />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={34} />
                    <Tooltip contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }} formatter={(v) => [v, 'momentum']} />
                    <Area dataKey="score" stroke="#e8431b" strokeWidth={2.5} fill="url(#mofill)" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0' }}>
              Momentum blends consistency, heart-rate efficiency, and load health into one rising/falling score. It appears once you've logged a couple of weeks of runs.
            </p>
          )}
        </div>
      </div>

      {/* Injury-risk + projection */}
      <div className="grid-2">
        <div>
          <h2 className="sec-h">Injury-risk · training load</h2>
          <div className="panel">
            {load.status === 'baseline' ? (
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>{STATUS_TEXT.baseline}</p>
            ) : (
              <>
                <div className="bigstat">
                  <span className={`v s-${load.status}`}>{load.acwr}</span>
                  <span className="u">acute : chronic load</span>
                </div>
                <div className="gauge">
                  <div className="sweet" style={{ left: '40%', width: '25%' }} />
                  <div className="marker" style={{ left: `${Math.min(100, Math.max(0, (load.acwr / 2) * 100))}%` }} />
                </div>
                <div className="gauge-scale"><span>0</span><span>0.8</span><span>1.3</span><span>2.0</span></div>
              </>
            )}
            <div className="statline">
              <span>Last 7 days<b className="num">{load.acute} km</b></span>
              <span>Chronic (4-wk avg)<b className="num">{load.chronicWeekly} km/wk</b></span>
              <span>Week-on-week<b className="num" style={{ color: load.ramp > 10 ? 'var(--over)' : 'inherit' }}>{load.ramp == null ? '—' : `${load.ramp > 0 ? '+' : ''}${load.ramp}%`}</b></span>
            </div>
            <p className={`verdict-line s-${load.status}`}>{STATUS_TEXT[load.status]}</p>
          </div>
        </div>

        <div>
          <h2 className="sec-h">Marathon projection</h2>
          <div className="panel">
            {proj ? (
              <>
                <div className="bigstat">
                  <span className="v">{fmtClock(proj.projectedSec)}</span>
                  <span className="u">projected now</span>
                </div>
                <div className="statline">
                  {proj.goalSec && <span>Goal<b className="num">{fmtClock(proj.goalSec)}</b></span>}
                  {proj.gapSec != null && (
                    <span>Gap to goal<b className="num" style={{ color: proj.gapSec <= 0 ? 'var(--good)' : 'var(--over)' }}>
                      {proj.gapSec <= 0 ? '−' : '+'}{fmtClock(Math.abs(proj.gapSec))}
                    </b></span>
                  )}
                </div>
                <p className="verdict-line" style={{ color: 'var(--muted)', fontWeight: 400 }}>
                  Reads conservative during easy base work; drops sharply once marathon-pace sessions begin.
                </p>
              </>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>
                No recent run over 5 km to project from yet. Once you log a longer effort this estimates your finish against the {mp ? fmtClock(mpSec * 42.195) : 'goal'} target.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Projection timeline */}
      <div className="block">
        <h2 className="sec-h">Projected finish over the build</h2>
        {raceProj && (
          <div className="bigstat" style={{ marginBottom: 4 }}>
            <span className="v">{fmtClock(raceProj.proj)}</span>
            <span className="u">projected race day ({fmtClock(raceProj.projBand[0])}–{fmtClock(raceProj.projBand[1])})</span>
          </div>
        )}
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 8px' }}>
          The shaded band is your forward projection — anchored on your real Garmin race estimate (~{projCfg && projCfg.model ? fmtClock(projCfg.model.start_s) : '—'} now) and projecting realistic, decelerating improvement as fitness consolidates, with a taper bump at the end. Solid gray dots are Garmin's actual recent estimates; orange is the live projection from your logged runs. The {projCfg ? fmtClock(projCfg.goal_s) : '3:45'} goal is the dotted reference. Lower is faster.
        </p>
        <div className="panel" style={{ paddingLeft: 6 }}>
          {projTimeline.length ? (
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <ComposedChart data={projTimeline} margin={{ top: 8, right: 12, bottom: 0, left: 6 }}>
                  <defs>
                    <linearGradient id="bandfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8431b" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#e8431b" stopOpacity={0.16} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e4dccd" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} interval={0} tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                  <YAxis domain={['dataMin - 300', 'dataMax + 400']} tickFormatter={(s) => `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={52} reversed />
                  <Tooltip
                    contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }}
                    formatter={(v, n) => {
                      if (n === 'projBand' || v == null) return [null, null]
                      const lbl = { proj: 'projected', garmin: 'Garmin actual', actual: 'from your runs', goal: 'goal' }[n] || n
                      return [Array.isArray(v) ? `${fmtClock(v[0])}–${fmtClock(v[1])}` : fmtClock(v), lbl]
                    }}
                  />
                  <Area dataKey="projBand" name="projBand" stroke="none" fill="url(#bandfill)" isAnimationActive={false} connectNulls legendType="none" />
                  <ReferenceLine y={projTimeline[0].goal} stroke="#2e7d52" strokeDasharray="2 3" label={{ value: 'goal 3:45', fill: '#2e7d52', fontSize: 11, fontFamily: 'IBM Plex Mono', position: 'insideBottomRight' }} />
                  <Line dataKey="proj" name="proj" stroke="#e8431b" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                  <Line dataKey="garmin" name="garmin" stroke="#5f5e5a" strokeWidth={0} dot={{ r: 4, fill: '#5f5e5a' }} isAnimationActive={false} legendType="none" />
                  <Line dataKey="actual" name="actual" stroke="#b07410" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: '#b07410' }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>Projection appears once activity data loads.</p>
          )}
        </div>
        <p style={{ color: 'var(--faint)', fontSize: 12, margin: '10px 2px 0' }}>
          Note: Garmin-style estimates run optimistic for the marathon — they reward speed and VO₂max but don't fully price in the late-race fade past 30 km. Treat the band as fitness potential; race-day execution (pacing, fueling, the wall) decides where in it you land. The forward shape is a model you can tune in <code>public/projection.json</code>.
        </p>
      </div>

      {/* Course + weather model */}
      {raceProj && raceCfg && courseAdj && (
        <div className="block">
          <h2 className="sec-h">Race-day conditions — {raceCfg.name}</h2>
          <div className="grid-2">
            <div className="panel">
              <div className="bigstat">
                <span className="v">{fmtClock(courseAdj.adjustedSec)}</span>
                <span className="u">conditions-adjusted finish</span>
              </div>
              <div className="statline">
                <span>Flat &amp; cool baseline<b className="num">{fmtClock(raceProj.proj)}</b></span>
                <span>{courseAdj.usingForecast ? 'Forecast' : 'Typical'} temp<b className="num">{courseAdj.temp}°C</b></span>
                <span>Net climb<b className="num">{courseAdj.gain} m</b></span>
              </div>
              <p className="verdict-line" style={{ color: 'var(--muted)', fontWeight: 400 }}>
                {courseAdj.heatSec > 30
                  ? `Warmth adds about ${fmtClock(courseAdj.heatSec)}; `
                  : 'Temperature is near the racing optimum, so it costs you almost nothing; '}
                {courseAdj.elevSec > 30 ? `the climb adds about ${fmtClock(courseAdj.elevSec)}.` : 'the course is flat enough that elevation is a rounding error.'}
              </p>
            </div>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <p style={{ fontSize: 13.5, color: 'var(--ink)', margin: '0 0 10px' }}>{raceCfg.course_note}</p>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
                {raceCfg.city} · {new Date(raceCfg.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
                Set the real forecast temperature in <code>public/race.json</code> as the day approaches to sharpen this — right now it's using the {raceCfg.forecast_temp_c != null ? 'forecast you entered' : 'typical late-October normal'}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ghost runner */}
      <div className="block">
        <h2 className="sec-h">Race-day ghost</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
          Watch your projected race unfold against an even goal-pace ghost. Press play and see where you pull ahead — and where the back-half fade lets the ghost reel you back in.
        </p>
        <div className="panel">
          {projCfg ? (
            <GhostRunner
              race={raceCfg}
              goalSec={(projCfg && projCfg.goal_s) || 13500}
              projSec={courseAdj ? courseAdj.adjustedSec : raceProj ? raceProj.proj : null}
              decouplingPct={(deco && deco.runs && deco.runs.filter((r) => r.decoupling != null).length)
                ? deco.runs.filter((r) => r.decoupling != null).reduce((t, r) => t + r.decoupling, 0) / deco.runs.filter((r) => r.decoupling != null).length
                : null}
            />
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0' }}>The race-day ghost appears once projection data loads.</p>
          )}
        </div>
      </div>

      {/* Weekly volume */}
      <div className="block">
        <h2 className="sec-h">Weekly volume — planned vs actual</h2>
        <div className="legend" style={{ flexDirection: 'row', gap: 18, marginBottom: 6 }}>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#c3b8a4' }} />Planned</span>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#e8431b' }} />Actual</span>
          <span className="li" style={{ width: 'auto', color: 'var(--faint)' }}>B1–B{baseN} base · W1–W{buildN} build</span>
        </div>
        <div className="panel" style={{ paddingLeft: 6 }}>
          <div style={{ width: '100%', height: 290 }}>
            <ResponsiveContainer>
              <BarChart data={weekly} margin={{ top: 8, right: 10, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="#e4dccd" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} interval={0} tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={42} unit=" km" />
                <Tooltip contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }} formatter={(v, n) => [`${v} km`, n]} />
                <Bar dataKey="planned" fill="#c3b8a4" radius={[2, 2, 0, 0]} maxBarSize={13} />
                <Bar dataKey="actual" fill="#e8431b" radius={[2, 2, 0, 0]} maxBarSize={13} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Pace vs target */}
      <div className="block">
        <h2 className="sec-h">Easy-run pace vs prescribed band</h2>
        <div className="legend" style={{ flexDirection: 'row', gap: 16, marginBottom: 6 }}>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#e4dccd' }} />Target band</span>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#2e7d52', borderRadius: '50%' }} />In zone</span>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#c0492b', borderRadius: '50%' }} />Ran hot</span>
          <span className="li" style={{ width: 'auto' }}><span className="sw" style={{ background: '#b07410', borderRadius: '50%' }} />Very easy</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 8px' }}>
          Dot position shows actual pace against the band; dot colour shows the heart-rate verdict — a fast dot in green means you beat the easy pace but kept HR honest.
        </p>
        <div className="panel" style={{ paddingLeft: 6 }}>
          {pace.length ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={pace} margin={{ top: 8, right: 10, bottom: 0, left: -6 }}>
                  <CartesianGrid vertical={false} stroke="#e4dccd" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                  <YAxis domain={paceDomain} tickFormatter={paceTick} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }}
                    formatter={(v, n) => (n === 'actual' ? [fmtPace(v), 'actual'] : [`${paceTick(v[0])}–${paceTick(v[1])}`, 'target'])}
                  />
                  <Bar dataKey="band" fill="#e4dccd" radius={[3, 3, 3, 3]} maxBarSize={26} />
                  <Line dataKey="actual" stroke="transparent" isAnimationActive={false} dot={renderDot} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>
              No completed runs to plot yet. Each run shows up as a dot against its target band — dots below the band mean you ran faster than the easy prescription.
            </p>
          )}
        </div>
      </div>

      {/* Week navigator + HR zone */}
      <div className="grid-2">
        <div>
          <div className="weeknav">
            <button onClick={() => setSel((s) => Math.max(minSeq, s - 1))} disabled={sel <= minSeq}>← prev</button>
            <div>
              <div className="wk-title">
                {selMeta.week_label} <span className="tag">{selMeta.phase}</span>
                {isStepback && <span className="tag">stepback</span>} {isTaper && <span className="tag">taper</span>}
              </div>
              <div className="wk-sub">{selSessions[0] && `${DAY_MONTH(selSessions[0].date)} – ${DAY_MONTH(selSessions[selSessions.length - 1].date)}`}</div>
            </div>
            <button style={{ marginLeft: 'auto' }} onClick={() => setSel((s) => Math.min(maxSeq, s + 1))} disabled={sel >= maxSeq}>next →</button>
          </div>
          <div className="rows">
            {selSessions.map((s) => (
              <div key={s.id} className={`row ${s.status === 'support' ? 'support' : ''}`}>
                <div className="day">{s.weekday}<b>{DAY_MONTH(s.date)}</b></div>
                <div className="what">{s.is_run ? `${s.distance_km} km` : s.type}<div className="ty">{s.is_run ? s.type : 'support'}</div></div>
                <div className="col pace">
                  {s.is_run ? (
                    <><span className="k">target</span><br /><span className="v">{s.pace_target ? s.pace_target.display : '—'}</span><br /><span className="v" style={{ color: 'var(--muted)' }}>{hrText(s.hr_target)} bpm</span></>
                  ) : <span className="v" style={{ color: 'var(--faint)' }}>{hrText(s.hr_target)} bpm</span>}
                </div>
                <div className="col">
                  {s.actual ? (
                    <><span className="k">actual{s.actual.count > 1 ? ` ×${s.actual.count}` : ''}</span><br /><span className="v">{s.actual.distance_km} km · {fmtPace(s.actual.pace_sec_per_km)}</span><br /><span className={`v hr-${s.hr || 'in'}`}>{s.actual.avg_hr ? <><span className="hrdot" />{s.actual.avg_hr} bpm</> : '—'}</span></>
                  ) : <span className="v" style={{ color: 'var(--faint)' }}>—</span>}
                </div>
                <span className={`pill ${s.status}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="sec-h">HR-zone adherence</h2>
          <div className="panel">
            {zoneData.length ? (
              <>
                <div style={{ width: '100%', height: 168 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={zoneData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                        {zoneData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8 }} formatter={(v, n) => [`${v} runs`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="legend">
                  {zoneData.map((d) => (<div className="li" key={d.name}><span className="sw" style={{ background: d.color }} />{d.name}<span className="n">{d.value}</span></div>))}
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0' }}>No completed runs with heart-rate data yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Aerobic decoupling */}
      <div className="block">
        <h2 className="sec-h">Long-run aerobic decoupling</h2>
        <div className="panel" style={{ paddingLeft: 6 }}>
          {deco == null ? (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>Analysing your longest recent runs…</p>
          ) : decoRuns.length ? (
            <>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 8px 4px' }}>
                HR drift from first half to second half at the same effort. Under 5% (the dashed line) means your aerobic base held — higher means fatigue, heat, or under-fuelling crept in.
              </p>
              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer>
                  <BarChart data={decoRuns} margin={{ top: 8, right: 10, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="#e4dccd" />
                    <XAxis dataKey="date" tickFormatter={DAY_MONTH} tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                    <YAxis unit="%" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={42} />
                    <Tooltip contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }} formatter={(v, _n, p) => [`${v}% · ${p.payload.distance_km} km`, 'decoupling']} labelFormatter={DAY_MONTH} />
                    <ReferenceLine y={5} stroke="#837a6d" strokeDasharray="4 4" />
                    <Bar dataKey="decoupling" radius={[3, 3, 0, 0]} maxBarSize={36}>
                      {decoRuns.map((d) => <Cell key={d.id} fill={decoColor(d.decoupling)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>
              No runs with heart-rate streams to analyse yet (needs runs of 5 km+ recorded with a HR strap/watch). Your long runs will show up here as the plan ramps.
            </p>
          )}
        </div>
      </div>

      {/* Cross-training */}
      <div className="block">
        <h2 className="sec-h">Cross-training & all activity</h2>
        {ctTotals.length ? (
          <>
            <div className="chips">
              {ctTotals.map((t) => (
                <div className="chip" key={t.type}>
                  <span className="dot" style={{ background: TYPE_COLOR[t.type] || '#a89f90' }} />
                  <span>
                    <span className="ct">{t.type}</span>{' '}
                    <span className="cm">{t.count}× · {fmtDuration(t.minutes * 60)}{t.km > 0 ? ` · ${t.km} km` : ''}</span>
                  </span>
                </div>
              ))}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '14px 0 6px' }}>
              Weekly time by activity — your full aerobic load, not just running. Soccer and cycling carry real cardio benefit even though they're not in the run plan.
            </p>
            <div className="panel" style={{ paddingLeft: 6 }}>
              <div style={{ width: '100%', height: 270 }}>
                <ResponsiveContainer>
                  <BarChart data={ctWeekly.rows} margin={{ top: 8, right: 10, bottom: 0, left: -10 }}>
                    <CartesianGrid vertical={false} stroke="#e4dccd" />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} interval={0} tickLine={false} axisLine={{ stroke: '#d3c9b6' }} />
                    <YAxis unit=" min" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#837a6d' }} tickLine={false} axisLine={false} width={50} />
                    <Tooltip contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #d3c9b6', borderRadius: 8, background: '#fcfaf5' }} formatter={(v, n) => [`${v} min`, n]} />
                    <Legend wrapperStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 11 }} iconType="circle" iconSize={8} />
                    {ctWeekly.types.map((t) => (
                      <Bar key={t} dataKey={t} stackId="a" fill={TYPE_COLOR[t] || '#a89f90'} maxBarSize={22} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : (
          <div className="panel"><p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0' }}>No activities logged yet — runs, rides, soccer and everything else will appear here once Strava data loads.</p></div>
        )}
      </div>

      {/* Full activity log */}
      <div className="block">
        <h2 className="sec-h">Activity log — everything{extras.length ? ` · ${extras.length} extra run${extras.length > 1 ? 's' : ''}` : ''}</h2>
        <div className="panel" style={{ padding: '4px 8px' }}>
          {log.length ? (
            <div className="scroll-log">
              <table>
                <thead>
                  <tr><th>Date</th><th>Activity</th><th className="num">Dist</th><th className="num">Time</th><th className="num">Pace</th><th className="num">HR</th></tr>
                </thead>
                <tbody>
                  {log.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{DAY_MONTH(a.date)}</td>
                      <td>
                        <span className="log-type"><span className="dot" style={{ background: TYPE_COLOR[a.group] || '#a89f90' }} />{a.group}</span>
                        {a.tag && <span className={`minitag ${a.tag}`} style={{ marginLeft: 8 }}>{a.tag}</span>}
                      </td>
                      <td className="num">{a.distance_km > 0 ? `${a.distance_km} km` : '—'}</td>
                      <td className="num">{fmtDuration(a.moving_time_s)}</td>
                      <td className="num">{a.group === 'Run' && a.pace_sec_per_km ? fmtPace(a.pace_sec_per_km) : '—'}</td>
                      <td className="num">{a.avg_hr || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>No activities in range yet.</p>
          )}
        </div>
      </div>

      {/* Recent completed runs */}
      <div className="block">
        <h2 className="sec-h">Scheduled runs — plan vs actual</h2>
        <div className="panel" style={{ padding: '4px 8px' }}>
          {recentDone.length ? (
            <table>
              <thead>
                <tr><th>Date</th><th>Session</th><th className="num">Plan</th><th className="num">Actual</th><th className="num">Pace</th><th className="num">HR (target)</th><th>Verdict</th></tr>
              </thead>
              <tbody>
                {recentDone.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{DAY_MONTH(s.date)}</td>
                    <td><span style={{ color: 'var(--faint)' }}>{s.week_short}</span> · {s.type}</td>
                    <td className="num">{s.distance_km} km</td>
                    <td className="num">{s.actual.distance_km} km</td>
                    <td className="num">{fmtPace(s.actual.pace_sec_per_km)}</td>
                    <td className={`num hr-${s.hr || 'in'}`}>{s.actual.avg_hr || '—'} <span style={{ color: 'var(--faint)' }}>({hrText(s.hr_target)})</span></td>
                    <td className={`hr-${s.hr || 'in'}`} style={{ fontWeight: 500 }}>{s.hr === 'in' ? 'In zone' : s.hr === 'over' ? 'Ran hot' : s.hr === 'under' ? 'Very easy' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>No completed runs in range yet.</p>
          )}
        </div>
      </div>

      <p className="foot">Plan parsed from your Google Calendar export · actual runs via Strava{fetchedAt ? ` · updated ${new Date(fetchedAt).toLocaleString()}` : ''}</p>
    </div>
  )
}
