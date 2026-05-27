// Pure functions that join the plan to actual activities and grade each session.
// "On target" is judged primarily by heart-rate zone, not pace.
//
// The plan has two phases: a 4-week Base block then an 18-week Build block.
// Every session carries `seq` (a global chronological week index) and
// `week_label` / `week_short` for display.

export const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
const MARATHON_KM = 42.195;

export function fmtPace(secPerKm) {
  if (secPerKm == null) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}
export function fmtDuration(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}
export function fmtClock(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Shift a YYYY-MM-DD string by N days (noon-UTC anchor avoids tz off-by-one).
function shiftISO(iso, deltaDays) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function aggregateRuns(acts) {
  const distance_km = +sum(acts, (a) => a.distance_km).toFixed(2);
  const moving_time_s = sum(acts, (a) => a.moving_time_s);
  const withHr = acts.filter((a) => a.avg_hr != null);
  const avg_hr = withHr.length
    ? Math.round(sum(withHr, (a) => a.avg_hr * a.moving_time_s) / sum(withHr, (a) => a.moving_time_s))
    : null;
  const max_hr = acts.reduce((m, a) => Math.max(m, a.max_hr || 0), 0) || null;
  return {
    count: acts.length, distance_km, moving_time_s,
    pace_sec_per_km: distance_km > 0 ? Math.round(moving_time_s / distance_km) : null,
    avg_hr, max_hr,
  };
}
function hrVerdict(target, actualHr) {
  if (!target || actualHr == null) return null;
  const lo = target.min ?? 0, hi = target.max ?? 999;
  if (actualHr > hi) return 'over';
  if (actualHr < lo) return 'under';
  return 'in';
}

export function buildSessions(plan, activities, todayISO) {
  const runsByDate = {};
  for (const a of activities) if (a.type === 'Run') (runsByDate[a.date] ||= []).push(a);
  return plan.map((p) => {
    const acts = p.is_run ? runsByDate[p.date] : null;
    const actual = acts && acts.length ? aggregateRuns(acts) : null;
    const past = p.date < todayISO;
    let status = !p.is_run ? 'support' : actual ? 'done' : past ? 'missed' : 'upcoming';
    const hr = actual ? hrVerdict(p.hr_target, actual.avg_hr) : null;
    return { ...p, actual, status, hr };
  });
}

export function weeklyVolume(sessions) {
  const byWeek = {};
  for (const s of sessions) {
    if (!s.is_run) continue;
    const w = (byWeek[s.seq] ||= { seq: s.seq, label: s.week_short, phase: s.phase, planned: 0, actual: 0 });
    w.planned += s.distance_km || 0;
    w.actual += s.actual ? s.actual.distance_km : 0;
  }
  return Object.values(byWeek).sort((a, b) => a.seq - b.seq)
    .map((w) => ({ week: w.label, seq: w.seq, phase: w.phase, planned: +w.planned.toFixed(1), actual: +w.actual.toFixed(1) }));
}

export function adherence(sessions) {
  const completed = sessions.filter((s) => s.status === 'done');
  const missed = sessions.filter((s) => s.status === 'missed').length;
  const withHr = completed.filter((s) => s.hr);
  const inZone = withHr.filter((s) => s.hr === 'in').length;
  return {
    completed: completed.length, missed,
    completionRate: completed.length + missed > 0 ? Math.round((100 * completed.length) / (completed.length + missed)) : null,
    hrInZone: inZone, hrOver: withHr.filter((s) => s.hr === 'over').length, hrUnder: withHr.filter((s) => s.hr === 'under').length,
    hrRated: withHr.length, zoneRate: withHr.length ? Math.round((100 * inZone) / withHr.length) : null,
  };
}

export function currentSeq(plan, todayISO) {
  const seqs = [...new Set(plan.map((p) => p.seq))].sort((a, b) => a - b);
  for (const sq of seqs) {
    const days = plan.filter((p) => p.seq === sq).map((p) => p.date).sort();
    if (todayISO <= days[days.length - 1]) return sq;
  }
  return seqs[seqs.length - 1];
}

// ---- Injury-risk load (acute:chronic workload ratio + week ramp) ----
export function trainingLoad(activities, todayISO) {
  const dayKm = {};
  for (const a of activities) if (a.type === 'Run') dayKm[a.date] = (dayKm[a.date] || 0) + a.distance_km;
  const window = (start, len) => { let t = 0; for (let i = start; i < start + len; i++) t += dayKm[shiftISO(todayISO, -i)] || 0; return t; };
  const acute = window(0, 7);
  const chronic28 = window(0, 28);
  const chronicWeekly = chronic28 / 4;
  const prev7 = window(7, 7);
  const acwr = chronicWeekly > 0 ? acute / chronicWeekly : null;
  const ramp = prev7 > 0 ? ((acute - prev7) / prev7) * 100 : null;
  let status = 'ok';
  if (chronicWeekly < 5) status = 'baseline';
  else if (acwr > 1.5) status = 'high';
  else if (acwr > 1.3) status = 'caution';
  else if (acwr < 0.8) status = 'detrain';
  return {
    acute: +acute.toFixed(1), prev7: +prev7.toFixed(1), chronicWeekly: +chronicWeekly.toFixed(1),
    acwr: acwr != null ? +acwr.toFixed(2) : null, ramp: ramp != null ? Math.round(ramp) : null, status,
  };
}

// ---- Marathon finish projection (Riegel) from best recent effort ----
export function projection(activities, mpSecPerKm, todayISO) {
  const cutoff = shiftISO(todayISO, -42);
  const cand = activities.filter((a) => a.type === 'Run' && a.date >= cutoff && a.distance_km >= 5 && a.moving_time_s > 0);
  if (!cand.length) return null;
  let best = null;
  for (const a of cand) {
    const proj = a.moving_time_s * Math.pow(MARATHON_KM / a.distance_km, 1.06);
    if (best == null || proj < best.proj) best = { proj, a };
  }
  const goalSec = mpSecPerKm ? mpSecPerKm * MARATHON_KM : null;
  return {
    projectedSec: Math.round(best.proj), fromDate: best.a.date, fromDist: best.a.distance_km,
    goalSec: goalSec ? Math.round(goalSec) : null, gapSec: goalSec ? Math.round(best.proj - goalSec) : null,
  };
}

// ---- Pace vs prescribed band, per completed run ----
export function paceSeries(sessions) {
  return sessions
    .filter((s) => s.status === 'done' && s.actual && s.actual.pace_sec_per_km && s.pace_target)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      name: new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      type: s.type, actual: s.actual.pace_sec_per_km,
      band: [s.pace_target.min_sec, s.pace_target.max_sec], verdict: s.hr || 'in',
    }));
}
