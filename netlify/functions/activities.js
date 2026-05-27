// Refreshes the short-lived access token using the stored refresh token, then
// pulls recent activities from Strava and returns a slimmed list. The client
// secret never leaves the server. Strava access tokens expire every 6 hours,
// so we refresh on every call rather than storing an access token.

const LOOKBACK_DAYS = 180;

export const handler = async () => {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;

  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return json(500, { error: 'config', message: 'STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET are not set.' });
  }
  if (!STRAVA_REFRESH_TOKEN) {
    return json(400, { error: 'no_refresh_token', message: 'Visit /.netlify/functions/strava-auth once to connect Strava, then set STRAVA_REFRESH_TOKEN.' });
  }

  try {
    // 1) Refresh the access token.
    const tokRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: STRAVA_REFRESH_TOKEN,
      }),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) {
      return json(502, { error: 'token_refresh_failed', detail: tok });
    }

    // 2) Page through recent activities.
    const after = Math.floor((Date.now() - LOOKBACK_DAYS * 86400 * 1000) / 1000);
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${tok.access_token}` } }
      );
      if (r.status === 429) return json(429, { error: 'rate_limited', message: 'Strava rate limit hit, try again shortly.' });
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }

    // 3) Slim the payload to what the dashboard needs.
    const activities = all.map((a) => {
      const km = a.distance ? a.distance / 1000 : 0;
      return {
        id: a.id,
        name: a.name,
        type: a.sport_type || a.type,
        date: (a.start_date_local || a.start_date || '').slice(0, 10),
        distance_km: +km.toFixed(2),
        moving_time_s: a.moving_time || 0,
        pace_sec_per_km: km > 0 ? Math.round((a.moving_time || 0) / km) : null,
        avg_hr: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
        max_hr: a.max_heartrate != null ? Math.round(a.max_heartrate) : null,
        elev_gain_m: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
      };
    });

    return json(200, { fetched_at: new Date().toISOString(), count: activities.length, activities }, 300);
  } catch (err) {
    return json(500, { error: 'server', message: String(err) });
  }
};

function json(statusCode, body, maxAge = 0) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
    body: JSON.stringify(body),
  };
}
