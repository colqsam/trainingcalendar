import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, ComposedChart, Line, ReferenceLine,
} from 'recharts'
import { loadPlan, loadActivities, loadDecoupling } from './api'
import {
  buildSessions, weeklyVolume, adherence, currentSeq, trainingLoad,
  projection, paceSeries, fmtPace, fmtClock,
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

export default function App() {
  const [plan, setPlan] = useState(null)
  const [activities, setActivities] = useState([])
  const [actError, setActError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [deco, setDeco] = useState(null)
  const [sel, setSel] = useState(null)
  const todayISO = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    loadPlan().then((p) => { setPlan(p); setSel(currentSeq(p, todayISO)) })
    loadActivities().then((r) => { setActivities(r.activities); if (r.error) setActError(r.error); if (r.fetchedAt) setFetchedAt(r.fetchedAt) })
    loadDecoupling().then((r) => setDeco(r))
  }, [])

  const sessions = useMemo(() => (plan ? buildSessions(plan, activities, todayISO) : []), [plan, activities])
  const weekly = useMemo(() => (plan ? weeklyVolume(plan, sessions, activities) : []), [plan, sessions, activities])
  const stats = useMemo(() => adherence(sessions), [sessions])
  const load = useMemo(() => trainingLoad(activities, todayISO), [activities])
  const pace = useMemo(() => paceSeries(sessions), [sessions])

  if (!plan) return <div className="wrap"><p style={{ marginTop: 60 }}>Loading plan…</p></div>

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
                  <span className="u">projected finish</span>
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
                  Rough Riegel estimate from your fastest recent effort ({proj.fromDist} km, {DAY_MONTH(proj.fromDate)}). It reads conservative during easy base work and drops sharply once marathon-pace sessions begin.
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

      {/* Recent completed runs */}
      <div className="block">
        <h2 className="sec-h">Recent completed runs</h2>
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
