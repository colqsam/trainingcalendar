// Pure functions that join the plan to actual activities and grade each session.
// "On target" is judged primarily by heart-rate zone, not pace — easy runs that
// come in quick but stay in the HR band still count as on-plan.
//
// The plan has two phases: a 4-week Base block then an 18-week Build block.
// Every session carries `seq` (a global chronological week index) and
// `week_label` / `week_short` for display.

export const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);

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

function aggregateRuns(acts) {
  const distance_km = +sum(acts, (a) => a.distance_km).toFixed(2);
  const moving_time_s = sum(acts, (a) => a.moving_time_s);
  const withHr = acts.filter((a) => a.avg_hr != null);
  const avg_hr = withHr.length
    ? Math.round(sum(withHr, (a) => a.avg_hr * a.moving_time_s) / sum(withHr, (a) => a.moving_time_s))
    : null;
  const max_hr = acts.reduce((m, a) => Math.max(m, a.max_hr || 0), 0) || null;
  return {
    count: acts.length,
    distance_km,
    moving_time_s,
    pace_sec_per_km: distance_km > 0 ? Math.round(moving_time_s / distance_km) : null,
    avg_hr,
    max_hr,
  };
}

function hrVerdict(target, actualHr) {
  if (!target || actualHr == null) return null;
  const lo = target.min ?? 0;
  const hi = target.max ?? 999;
  if (actualHr > hi) return 'over';
  if (actualHr < lo) return 'under';
  return 'in';
}

export function buildSessions(plan, activities, todayISO) {
  const runsByDate = {};
  for (const a of activities) {
    if (a.type === 'Run') (runsByDate[a.date] ||= []).push(a);
  }
  return plan.map((p) => {
    const acts = p.is_run ? runsByDate[p.date] : null;
    const actual = acts && acts.length ? aggregateRuns(acts) : null;
    const past = p.date < todayISO;
    let status;
    if (!p.is_run) status = 'support';
    else if (actual) status = 'done';
    else if (past) status = 'missed';
    else status = 'upcoming';
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
  return Object.values(byWeek)
    .sort((a, b) => a.seq - b.seq)
    .map((w) => ({ week: w.label, seq: w.seq, phase: w.phase, planned: +w.planned.toFixed(1), actual: +w.actual.toFixed(1) }));
}

export function adherence(sessions) {
  const completed = sessions.filter((s) => s.status === 'done');
  const missed = sessions.filter((s) => s.status === 'missed').length;
  const withHr = completed.filter((s) => s.hr);
  const inZone = withHr.filter((s) => s.hr === 'in').length;
  const over = withHr.filter((s) => s.hr === 'over').length;
  const under = withHr.filter((s) => s.hr === 'under').length;
  return {
    completed: completed.length,
    missed,
    completionRate: completed.length + missed > 0 ? Math.round((100 * completed.length) / (completed.length + missed)) : null,
    hrInZone: inZone,
    hrOver: over,
    hrUnder: under,
    hrRated: withHr.length,
    zoneRate: withHr.length ? Math.round((100 * inZone) / withHr.length) : null,
  };
}

// The seq of the week whose date span contains today (clamped to plan range).
export function currentSeq(plan, todayISO) {
  const seqs = [...new Set(plan.map((p) => p.seq))].sort((a, b) => a - b);
  for (const sq of seqs) {
    const days = plan.filter((p) => p.seq === sq).map((p) => p.date).sort();
    if (todayISO <= days[days.length - 1]) return sq;
  }
  return seqs[seqs.length - 1];
}
