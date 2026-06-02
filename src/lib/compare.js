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

function weekSpans(plan) {
  const seqs = [...new Set(plan.map((p) => p.seq))].sort((a, b) => a - b);
  const starts = seqs.map((sq) => ({ seq: sq, start: plan.filter((p) => p.seq === sq).map((p) => p.date).sort()[0] }));
  return starts.map((s, i) => ({ seq: s.seq, start: s.start, end: i + 1 < starts.length ? starts[i + 1].start : shiftISO(s.start, 8) }));
}

// Planned km comes from the plan; actual km counts EVERY run that falls inside
// the week's date span — including unplanned/extra runs and races, not just runs
// that happened to land on a scheduled day.
export function weeklyVolume(plan, sessions, activities) {
  if (!plan || !plan.length) return [];
  const spans = weekSpans(plan);
  const meta = {};
  for (const s of sessions) meta[s.seq] = { label: s.week_short, phase: s.phase };
  const planned = {}, actual = {};
  for (const s of sessions) if (s.is_run) planned[s.seq] = (planned[s.seq] || 0) + (s.distance_km || 0);
  for (const a of activities || []) {
    if (a.type !== 'Run') continue;
    const sp = spans.find((x) => a.date >= x.start && a.date < x.end);
    if (sp) actual[sp.seq] = (actual[sp.seq] || 0) + a.distance_km;
  }
  return spans.filter((sp) => meta[sp.seq]).sort((a, b) => a.seq - b.seq).map((sp) => ({
    week: meta[sp.seq].label, seq: sp.seq, phase: meta[sp.seq].phase,
    planned: +(planned[sp.seq] || 0).toFixed(1), actual: +(actual[sp.seq] || 0).toFixed(1),
  }));
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

// ---- Activity-type helpers (cross-training) ----
// Group Strava's many sport_type values into the buckets we care about.
const TYPE_GROUP = {
  Run: 'Run', TrailRun: 'Run', VirtualRun: 'Run',
  Ride: 'Bike', VirtualRide: 'Bike', MountainBikeRide: 'Bike', GravelRide: 'Bike', EBikeRide: 'Bike',
  Soccer: 'Soccer', Workout: 'Workout', WeightTraining: 'Strength', Yoga: 'Yoga',
  Walk: 'Walk', Hike: 'Hike', Swim: 'Swim',
};
export function groupType(t) { return TYPE_GROUP[t] || t || 'Other'; }

export const TYPE_COLOR = {
  Run: '#e8431b', Bike: '#7f77dd', Soccer: '#d8a23a', Yoga: '#4a9b8e',
  Strength: '#b0606b', Workout: '#8a8378', Walk: '#9b874a', Hike: '#5f8f4a',
  Swim: '#4a7fb0', Other: '#a89f90',
};

// Per-week minutes and counts by activity group (for the stacked time chart).
export function crossTrainWeekly(plan, activities) {
  if (!plan || !plan.length) return { rows: [], types: [] };
  const spans = weekSpans(plan);
  const meta = {};
  for (const p of plan) meta[p.seq] = p.week_short;
  const byWeek = {};
  const typesSeen = new Set();
  for (const a of activities || []) {
    const sp = spans.find((x) => a.date >= x.start && a.date < x.end);
    if (!sp) continue;
    const g = groupType(a.type);
    typesSeen.add(g);
    (byWeek[sp.seq] ||= { seq: sp.seq, week: meta[sp.seq] })[g] =
      (byWeek[sp.seq][g] || 0) + (a.moving_time_s || 0) / 60;
  }
  const rows = spans.filter((sp) => meta[sp.seq] && byWeek[sp.seq])
    .map((sp) => {
      const r = { week: meta[sp.seq], seq: sp.seq };
      for (const t of typesSeen) r[t] = Math.round(byWeek[sp.seq][t] || 0);
      return r;
    });
  const order = ['Run', 'Bike', 'Soccer', 'Yoga', 'Strength', 'Workout', 'Walk', 'Hike', 'Swim', 'Other'];
  const types = order.filter((t) => typesSeen.has(t));
  return { rows, types };
}

// Totals by type over the whole logged history (for summary chips).
export function crossTrainTotals(activities) {
  const by = {};
  for (const a of activities || []) {
    const g = groupType(a.type);
    const b = (by[g] ||= { type: g, count: 0, minutes: 0, km: 0 });
    b.count++; b.minutes += (a.moving_time_s || 0) / 60; b.km += a.distance_km || 0;
  }
  return Object.values(by)
    .map((b) => ({ ...b, minutes: Math.round(b.minutes), km: +b.km.toFixed(1) }))
    .sort((a, b) => b.minutes - a.minutes);
}

// Full chronological activity log, newest first, with planned/extra tagging for runs.
export function activityLog(sessions, activities, limit = 40) {
  const plannedRunDates = new Set(sessions.filter((s) => s.is_run).map((s) => s.date));
  return (activities || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limit)
    .map((a) => {
      const g = groupType(a.type);
      const isRun = g === 'Run';
      return {
        id: a.id, date: a.date, group: g, name: a.name,
        distance_km: a.distance_km, moving_time_s: a.moving_time_s,
        pace_sec_per_km: a.pace_sec_per_km, avg_hr: a.avg_hr,
        tag: isRun ? (plannedRunDates.has(a.date) ? 'planned' : 'extra') : null,
      };
    });
}

// Unplanned ("extra") runs: runs on dates with no scheduled run session.
export function extraRuns(sessions, activities) {
  const plannedRunDates = new Set(sessions.filter((s) => s.is_run).map((s) => s.date));
  return (activities || [])
    .filter((a) => groupType(a.type) === 'Run' && !plannedRunDates.has(a.date))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---- Projection timeline ----
// Three grounded series across the plan weeks:
//   garmin  — REAL smoothed Garmin race predictions for weeks we have data for
//   proj    — forward projection from the current anchor: decelerating
//             improvement toward an asymptote, with a small taper freshness bump.
//             Carries a widening fast/slow confidence band.
//   actual  — live best-Riegel projection from runs logged up to each week.
// Nothing converges to the goal by construction; the goal is just a reference.
export function projectionTimeline(plan, activities, cfg, todayISO) {
  if (!plan || !plan.length || !cfg) return [];
  const spans = weekSpans(plan);
  const meta = {};
  for (const p of plan) meta[p.seq] = { label: p.week_short, phase: p.phase };
  const hist = {};
  for (const h of cfg.garmin_history || []) hist[h.week_short] = h;

  const m = cfg.model;
  const raceDate = spans[spans.length - 1].start;
  const anchor = new Date(cfg.anchor_date + 'T12:00:00Z');
  const race = new Date(raceDate + 'T12:00:00Z');
  const totalDays = Math.max(1, (race - anchor) / 86400000);
  const taperStartSeq = spans.length - 2; // last two weeks get the freshness bump

  return spans.filter((sp) => meta[sp.seq]).sort((a, b) => a.seq - b.seq).map((sp, i, arr) => {
    const label = meta[sp.seq].label;
    const row = { week: label, seq: sp.seq, phase: meta[sp.seq].phase, goal: cfg.goal_s };

    // Real Garmin history where we have it.
    if (hist[label]) {
      row.garmin = hist[label].mid_s;
      row.garminBand = [hist[label].fast_s, hist[label].slow_s];
    }

    // Forward projection for weeks at/after the anchor.
    const wkDate = new Date(sp.start + 'T12:00:00Z');
    if (wkDate >= anchor) {
      const p = Math.min(1, Math.max(0, (wkDate - anchor) / 86400000 / totalDays));
      let mid = m.asymptote_s + (m.start_s - m.asymptote_s) * Math.exp(-m.k * p);
      const idxFromEnd = arr.length - 1 - i;
      if (idxFromEnd <= 1) mid -= m.taper_bonus_s * (2 - idxFromEnd) / 2; // ramp the bump over the last 2 wks
      const band = m.band_base_s + m.band_growth_s * p;
      row.proj = Math.round(mid);
      row.projBand = [Math.round(mid - band), Math.round(mid + band)];
    }

    // Live actual from logged runs up to this week's end.
    if (sp.start <= todayISO) {
      const upto = activities.filter((a) => a.type === 'Run' && a.date < sp.end && a.distance_km >= 5 && a.moving_time_s > 0);
      let best = null;
      for (const a of upto) {
        const pj = a.moving_time_s * Math.pow(MARATHON_KM / a.distance_km, 1.06);
        if (best == null || pj < best) best = pj;
      }
      if (best != null) row.actual = Math.round(best);
    }
    return row;
  });
}

// ---- Momentum engine ----
// One rising/falling score (0–100) blending three signals over a trailing
// window, computed per training week so we can draw the trend:
//   consistency   — completed vs scheduled planned runs
//   efficiency    — meters-per-heartbeat vs your early-build baseline
//   load health   — how close acute:chronic load sits to the sweet spot
function metersPerBeat(acts) {
  const r = acts.filter((a) => a.type === 'Run' && a.avg_hr && a.distance_km > 0 && a.moving_time_s > 0);
  if (!r.length) return null;
  let dist = 0, beats = 0;
  for (const a of r) { dist += a.distance_km * 1000; beats += a.avg_hr * (a.moving_time_s / 60); }
  return beats > 0 ? dist / beats : null; // meters per heartbeat
}
function acwrAsOf(activities, endISO) {
  const dayKm = {};
  for (const a of activities) if (a.type === 'Run') dayKm[a.date] = (dayKm[a.date] || 0) + a.distance_km;
  const win = (start, len) => { let t = 0; for (let i = start; i < start + len; i++) t += dayKm[shiftISO(endISO, -i)] || 0; return t; };
  const acute = win(0, 7), chronicWk = win(0, 28) / 4;
  return chronicWk > 0 ? acute / chronicWk : null;
}
function loadHealthScore(acwr) {
  if (acwr == null) return 0.5;
  if (acwr >= 0.8 && acwr <= 1.3) return 1;
  if (acwr < 0.8) return Math.max(0, acwr / 0.8);
  return Math.max(0, 1 - (acwr - 1.3) / 0.7); // 1.3→1, 2.0→0
}
export function momentumSeries(plan, sessions, activities, todayISO) {
  if (!plan || !plan.length) return { points: [], current: null, delta: null, parts: null };
  const spans = weekSpans(plan);
  // baseline efficiency from the first 21 days of logged runs
  const firstRun = activities.filter((a) => a.type === 'Run').map((a) => a.date).sort()[0];
  let baselineEff = null;
  if (firstRun) baselineEff = metersPerBeat(activities.filter((a) => a.date < shiftISO(firstRun, -(-21))));
  const points = [];
  for (const sp of spans) {
    if (sp.start > todayISO) break;
    const endISO = sp.end <= todayISO ? sp.end : todayISO;
    const winStart = shiftISO(endISO, -21);
    const winActs = activities.filter((a) => a.date >= winStart && a.date < endISO);
    const winSessions = sessions.filter((s) => s.is_run && s.date >= winStart && s.date < endISO);
    const scheduled = winSessions.length;
    const completed = winSessions.filter((s) => s.status === 'done').length;
    if (scheduled === 0 && winActs.filter((a) => a.type === 'Run').length === 0) continue;
    const consistency = scheduled > 0 ? completed / scheduled : 0.6;
    const eff = metersPerBeat(winActs);
    let effScore = 0.5;
    if (eff && baselineEff) effScore = Math.max(0, Math.min(1, 0.5 + (eff / baselineEff - 1) * 5)); // ±10% → 0..1
    else if (eff && !baselineEff) { baselineEff = eff; effScore = 0.5; }
    const loadScore = loadHealthScore(acwrAsOf(activities, endISO));
    const score = Math.round(100 * (0.4 * consistency + 0.35 * effScore + 0.25 * loadScore));
    points.push({
      week: sessions.find((s) => s.seq === sp.seq)?.week_short || `#${sp.seq}`,
      seq: sp.seq, score,
      consistency: Math.round(consistency * 100),
      efficiency: Math.round(effScore * 100),
      load: Math.round(loadScore * 100),
    });
  }
  const current = points.length ? points[points.length - 1] : null;
  const prev = points.length > 1 ? points[points.length - 2] : null;
  return {
    points, current: current ? current.score : null,
    delta: current && prev ? current.score - prev.score : null,
    parts: current ? { consistency: current.consistency, efficiency: current.efficiency, load: current.load } : null,
  };
}

// ---- Course + weather adjustment to the projection ----
// Returns how much the real course (elevation) and race-day temperature bend a
// flat-and-cool baseline finish time. Heat model: minimal penalty near the
// 10–12°C optimum, rising above it. Elevation: a few seconds per net climb.
export function courseAdjust(baseSec, race) {
  if (!race || baseSec == null) return null;
  const optimum = 11;
  const temp = race.forecast_temp_c != null ? race.forecast_temp_c : race.normal_temp_c;
  let heatPct = 0;
  if (temp != null && temp > optimum) heatPct = Math.min(0.08, Math.pow((temp - optimum) / 10, 1.5) * 0.03);
  else if (temp != null && temp < -2) heatPct = 0.01; // very cold also costs a little
  const heatSec = Math.round(baseSec * heatPct);
  const gain = race.elevation_gain_m || 0;
  const elevSec = Math.round((gain / 100) * 8); // ~8s per 100 m of net climb over a marathon
  return {
    temp, heatSec, elevSec, gain,
    adjustedSec: Math.round(baseSec + heatSec + elevSec),
    usingForecast: race.forecast_temp_c != null,
  };
}

// ---- Ghost-runner race-day split model ----
// Builds cumulative time (seconds) at each km for two runners:
//   ghost — even goal pace the whole way
//   you   — your projected finish, modelled as a positive split whose back-half
//           fade scales with your measured aerobic decoupling (the wall ~32 km).
export function ghostRace(goalSec, projSec, decouplingPct, distanceKm = MARATHON_KM) {
  const n = Math.ceil(distanceKm);
  const goalPace = goalSec / distanceKm;
  // Fade: 0 decoupling → near-even; higher decoupling → bigger late slowdown.
  const fade = Math.max(0.02, Math.min(0.14, (decouplingPct ?? 6) / 100));
  // Build a per-km pace multiplier for "you": slightly hot early, fading late.
  const weights = [];
  for (let k = 0; k < n; k++) {
    const frac = k / (n - 1);
    // negative (faster) early, positive (slower) late, hinge ~0.72 (≈30 km)
    const shape = frac < 0.72 ? -0.25 * (1 - frac / 0.72) : Math.pow((frac - 0.72) / 0.28, 1.4);
    weights.push(1 + fade * shape);
  }
  const meanW = weights.reduce((a, b) => a + b, 0) / n;
  const yourAvgPace = (projSec || goalSec) / distanceKm;
  const youCum = [], ghostCum = [];
  let yt = 0, gt = 0;
  for (let k = 0; k < n; k++) {
    const segKm = k === n - 1 ? distanceKm - (n - 1) : 1;
    yt += yourAvgPace * (weights[k] / meanW) * segKm;
    gt += goalPace * segKm;
    youCum.push({ km: Math.min(k + 1, distanceKm), you: Math.round(yt), ghost: Math.round(gt) });
    ghostCum.push(gt);
  }
  return {
    splits: youCum,
    youFinish: Math.round(yt),
    ghostFinish: Math.round(gt),
    wallKm: 32,
    fadePct: +(fade * 100).toFixed(1),
  };
}
// Distance (km) each runner has covered at elapsed time t (seconds) — for animation.
export function distanceAtTime(splits, t, key) {
  if (!splits.length) return 0;
  if (t <= 0) return 0;
  let prevT = 0, prevKm = 0;
  for (const s of splits) {
    if (s[key] >= t) {
      const frac = (t - prevT) / (s[key] - prevT || 1);
      return prevKm + frac * (s.km - prevKm);
    }
    prevT = s[key]; prevKm = s.km;
  }
  return splits[splits.length - 1].km;
}

// ---- Weekly brief: assemble the signals worth connecting ----
// Gathers the cross-panel facts a human would otherwise have to assemble by
// scrolling, into one object — used both for the AI prompt and the local
// fallback text. Pure data; no judgments baked in here.
export function briefSignals({ plan, sessions, activities, todayISO, load, momentum, decoRuns, proj, courseAdj, raceCfg, mpSec }) {
  const curSeq = currentSeq(plan, todayISO);
  const curMeta = plan.find((p) => p.seq === curSeq) || {};
  const weekly = weeklyVolume(plan, sessions, activities);
  const curVol = weekly.find((w) => w.seq === curSeq);
  const longest = (activities || []).filter((a) => a.type === 'Run').reduce((m, a) => Math.max(m, a.distance_km), 0);
  const worstDecoup = (decoRuns || []).reduce((m, r) => (r.decoupling != null && r.decoupling > (m?.decoupling ?? -1) ? r : m), null);
  const extras = extraRuns(sessions, activities).length;
  const upcoming = sessions
    .filter((s) => s.is_run && s.date >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)
    .map((s) => ({ date: s.date, type: s.type, km: s.distance_km, weekday: s.weekday }));
  const nextLong = sessions
    .filter((s) => s.is_run && s.type === 'Long Run' && s.date >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysToRace = raceCfg ? Math.ceil((new Date(raceCfg.date) - new Date(todayISO)) / 86400000) : null;
  return {
    week_label: curMeta.week_label, phase: curMeta.phase, taper: curMeta.taper, stepback: curMeta.stepback,
    momentum: momentum?.current ?? null, momentum_delta: momentum?.delta ?? null,
    momentum_parts: momentum?.parts ?? null,
    acwr: load?.acwr ?? null, load_status: load?.status ?? null,
    acute_km: load?.acute ?? null, chronic_km: load?.chronicWeekly ?? null, ramp_pct: load?.ramp ?? null,
    week_done_km: curVol ? curVol.actual : 0, week_planned_km: curVol ? curVol.planned : 0,
    longest_run_km: +longest.toFixed(1),
    worst_decoupling: worstDecoup ? { pct: worstDecoup.decoupling, km: worstDecoup.distance_km, date: worstDecoup.date } : null,
    extra_runs: extras,
    proj_finish_s: proj?.projectedSec ?? null,
    adjusted_finish_s: courseAdj?.adjustedSec ?? null,
    goal_s: mpSec ? Math.round(mpSec * MARATHON_KM) : null,
    next_sessions: upcoming,
    next_long_km: nextLong ? nextLong.distance_km : null,
    days_to_race: daysToRace,
  };
}

// Deterministic fallback brief if the AI call is unavailable. Connects the
// signals plainly; durability past current longest run is framed as the open
// question (knee is no longer treated as the limiter).
export function localBrief(s) {
  if (!s) return [];
  const out = [];
  const clk = (x) => (x == null ? null : fmtClock(x));
  // 1) momentum + load relationship
  if (s.momentum != null && s.acwr != null) {
    if (s.momentum >= 75 && s.acwr >= 1.25) {
      out.push(`Momentum is high (${s.momentum}) with load near the top of your range (${s.acwr}:1) — the classic moment to resist adding miles, since everything feels good right when overreaching is easiest.`);
    } else if (s.momentum >= 70 && s.load_status === 'ok') {
      out.push(`Momentum is strong (${s.momentum}) and load sits in the sweet spot (${s.acwr}:1) — you're absorbing the work well. Keep doing exactly this.`);
    } else if (s.load_status === 'high') {
      out.push(`Load is running hot (${s.acwr}:1) — ease the next few days even though momentum (${s.momentum}) says you could push.`);
    } else if (s.momentum != null) {
      out.push(`Momentum is ${s.momentum}${s.momentum_delta > 1 ? ' and rising' : s.momentum_delta < -1 ? ' and cooling' : ', steady'}, load at ${s.acwr}:1 — a balanced spot.`);
    }
  }
  // 2) durability — the real open question
  if (s.worst_decoupling && s.worst_decoupling.pct >= 5) {
    out.push(`Your aerobic durability is the open question: the one long effort tested past 10 km (${s.worst_decoupling.km} km) decoupled to ${s.worst_decoupling.pct}%, above the 5% line. The build's job now is teaching your system to hold pace deep into a long run — distance endurance, not speed, is the thing to earn.`);
  } else if (s.longest_run_km < 16 && s.next_long_km) {
    out.push(`Longest run so far is ${s.longest_run_km} km; the plan's long runs climb from here. Build them patiently — back-half durability is what's still unproven, and it's earned one long run at a time.`);
  }
  // 3) extra runs, framed neutrally now that the knee is fine
  if (s.extra_runs >= 10) {
    out.push(`You've banked ${s.extra_runs} extra runs beyond the schedule — a real consistency habit. With the knee settled through your rehab, that's free aerobic base; just keep the easy ones genuinely easy so they add base rather than fatigue.`);
  }
  // 4) projection vs goal
  if (s.adjusted_finish_s && s.goal_s) {
    const gap = s.adjusted_finish_s - s.goal_s;
    out.push(`Conditions-adjusted projection is ${clk(s.adjusted_finish_s)} against your ${clk(s.goal_s)} goal — ${gap <= 0 ? `${clk(Math.abs(gap))} to spare, if the long runs confirm the fitness` : `${clk(gap)} to find, which the build is designed to close`}.`);
  }
  // 5) what's next
  if (s.next_long_km) out.push(`Next key session: a ${s.next_long_km} km long run — the one that matters most for the durability question above.`);
  return out;
}
