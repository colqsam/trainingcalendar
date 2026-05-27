import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'
import { loadPlan, loadActivities } from './api'
import {
  buildSessions, weeklyVolume, adherence, currentSeq, fmtPace,
} from './lib/compare'

const DAY_MONTH = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const hrText = (t) => (!t ? '—' : t.min ? `${t.min}–${t.max}` : `<${t.max}`)

export default function App() {
  const [plan, setPlan] = useState(null)
  const [activities, setActivities] = useState([])
  const [actError, setActError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [sel, setSel] = useState(null)

  const todayISO = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    loadPlan().then((p) => { setPlan(p); setSel(currentSeq(p, todayISO)) })
    loadActivities().then((r) => {
      setActivities(r.activities)
      if (r.error) setActError(r.error)
      if (r.fetchedAt) setFetchedAt(r.fetchedAt)
    })
  }, [])

  const sessions = useMemo(() => (plan ? buildSessions(plan, activities, todayISO) : []), [plan, activities])
  const weekly = useMemo(() => weeklyVolume(sessions), [sessions])
  const stats = useMemo(() => adherence(sessions), [sessions])

  if (!plan) return <div className="wrap"><p style={{ marginTop: 60 }}>Loading plan…</p></div>

  const seqs = [...new Set(plan.map((p) => p.seq))].sort((a, b) => a - b)
  const minSeq = seqs[0], maxSeq = seqs[seqs.length - 1]
  const baseN = Math.max(0, ...plan.filter((p) => p.phase === 'Base').map((p) => p.week))
  const buildN = Math.max(0, ...plan.filter((p) => p.phase === 'Build').map((p) => p.week))
  const runs = plan.filter((p) => p.is_run)
  const totalKm = Math.round(runs.reduce((t, r) => t + (r.distance_km || 0), 0))
  const peakLong = Math.max(...runs.map((r) => r.distance_km || 0))
  const mpSession = plan.find((p) => p.type === 'Pace Run' && p.pace_target)
  const mp = mpSession ? fmtPace(mpSession.pace_target.min_sec) : null
  const planStart = plan[0].date, planEnd = plan[plan.length - 1].date
  const daysToStart = Math.ceil((new Date(planStart) - new Date(todayISO)) / 86400000)

  const curSeq = currentSeq(plan, todayISO)
  const curLabel = (plan.find((p) => p.seq === curSeq) || {}).week_label
  const curRuns = sessions.filter((s) => s.seq === curSeq && s.is_run)
  const curDoneKm = curRuns.reduce((t, s) => t + (s.actual ? s.actual.distance_km : 0), 0)
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
          Showing your plan only — Strava isn’t wired up yet, so there are no actual runs to compare. To connect it: set <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> in Netlify, visit <a href="/.netlify/functions/strava-auth">/.netlify/functions/strava-auth</a> to authorize, then paste the refresh token into <code>STRAVA_REFRESH_TOKEN</code> and redeploy.
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
          <div className="val num">{Math.round(sessions.reduce((t, s) => t + (s.actual ? s.actual.distance_km : 0), 0))}<small> km</small></div>
          <p className="sub">actual run volume so far</p>
        </div>
      </div>

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
                <div className="what">
                  {s.is_run ? `${s.distance_km} km` : s.type}
                  <div className="ty">{s.is_run ? s.type : 'support'}</div>
                </div>
                <div className="col pace">
                  {s.is_run ? (
                    <>
                      <span className="k">target</span><br />
                      <span className="v">{s.pace_target ? s.pace_target.display : '—'}</span><br />
                      <span className="v" style={{ color: 'var(--muted)' }}>{hrText(s.hr_target)} bpm</span>
                    </>
                  ) : <span className="v" style={{ color: 'var(--faint)' }}>{hrText(s.hr_target)} bpm</span>}
                </div>
                <div className="col">
                  {s.actual ? (
                    <>
                      <span className="k">actual{s.actual.count > 1 ? ` ×${s.actual.count}` : ''}</span><br />
                      <span className="v">{s.actual.distance_km} km · {fmtPace(s.actual.pace_sec_per_km)}</span><br />
                      <span className={`v hr-${s.hr || 'in'}`}>{s.actual.avg_hr ? <><span className="hrdot" />{s.actual.avg_hr} bpm</> : '—'}</span>
                    </>
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
                  {zoneData.map((d) => (
                    <div className="li" key={d.name}><span className="sw" style={{ background: d.color }} />{d.name}<span className="n">{d.value}</span></div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0' }}>
                No completed runs with heart-rate data yet. Once your runs land on plan dates this shows how many hit their prescribed HR band — the truest read on whether your easy days were actually easy.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="block">
        <h2 className="sec-h">Recent completed runs</h2>
        <div className="panel" style={{ padding: '4px 8px' }}>
          {recentDone.length ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Session</th><th className="num">Plan</th><th className="num">Actual</th>
                  <th className="num">Pace</th><th className="num">HR (target)</th><th>Verdict</th>
                </tr>
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
                    <td className={`hr-${s.hr || 'in'}`} style={{ fontWeight: 500 }}>
                      {s.hr === 'in' ? 'In zone' : s.hr === 'over' ? 'Ran hot' : s.hr === 'under' ? 'Very easy' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 8px' }}>
              No completed runs in range yet. Runs you log on Strava that fall on plan dates will appear here automatically.
            </p>
          )}
        </div>
      </div>

      <p className="foot">
        Plan parsed from your Google Calendar export · actual runs via Strava
        {fetchedAt ? ` · updated ${new Date(fetchedAt).toLocaleString()}` : ''}
      </p>
    </div>
  )
}
