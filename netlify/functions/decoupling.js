// Computes aerobic decoupling for your longest recent runs. Decoupling is the
// drop in efficiency (speed-per-heartbeat) from the first half of a run to the
// second half — a low number means your aerobic base held steady, a high number
// means HR drifted up (fatigue, heat, or under-fuelling). Needs the per-run
// stream data, which the activities endpoint doesn't include, hence its own call.

const LOOKBACK_DAYS = 120;
const MAX_RUNS = 6;          // longest N runs to analyse (keeps API calls low)
const MIN_KM = 5;            // ignore very short runs

export const handler = async () => {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) return json(500, { error: 'config' });
  if (!STRAVA_REFRESH_TOKEN) return json(400, { error: 'no_refresh_token' });

  try {
    const tokRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: STRAVA_REFRESH_TOKEN }),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return json(502, { error: 'token_refresh_failed', detail: tok });
    const auth = { Authorization: `Bearer ${tok.access_token}` };

    const after = Math.floor((Date.now() - LOOKBACK_DAYS * 86400 * 1000) / 1000);
    const listRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: auth });
    if (listRes.status === 429) return json(429, { error: 'rate_limited' });
    const list = await listRes.json();
    const runs = (Array.isArray(list) ? list : [])
      .filter((a) => (a.sport_type || a.type) === 'Run' && a.distance >= MIN_KM * 1000)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, MAX_RUNS);

    const out = [];
    for (const r of runs) {
      let dec = null;
      try {
        const sRes = await fetch(`https://www.strava.com/api/v3/activities/${r.id}/streams?keys=heartrate,velocity_smooth,time&key_by_type=true`, { headers: auth });
        if (sRes.ok) dec = computeDecoupling(await sRes.json());
      } catch { /* leave dec null */ }
      out.push({
        id: r.id, name: r.name,
        date: (r.start_date_local || r.start_date || '').slice(0, 10),
        distance_km: +(r.distance / 1000).toFixed(1),
        decoupling: dec,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return json(200, { runs: out }, 600);
  } catch (err) {
    return json(500, { error: 'server', message: String(err) });
  }
};

function computeDecoupling(s) {
  if (!s || !s.heartrate || !s.velocity_smooth) return null;
  const hr = s.heartrate.data, v = s.velocity_smooth.data;
  const n = Math.min(hr.length, v.length);
  if (n < 120) return null;
  const half = Math.floor(n / 2);
  const ef = (a, b) => {
    let se = 0, sh = 0, c = 0;
    for (let i = a; i < b; i++) if (v[i] > 1.0 && hr[i] > 60) { se += v[i]; sh += hr[i]; c++; }
    return c < 20 ? null : (se / c) / (sh / c);
  };
  const ef1 = ef(0, half), ef2 = ef(half, n);
  if (ef1 == null || ef2 == null || ef1 === 0) return null;
  return +(((ef1 - ef2) / ef1) * 100).toFixed(1);
}

function json(statusCode, body, maxAge = 0) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
    body: JSON.stringify(body),
  };
}
