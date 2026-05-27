// One-time OAuth handshake. Visit this function in the browser with no params:
//   /.netlify/functions/strava-auth
// It redirects you to Strava to authorize, Strava redirects back here with a
// ?code=..., and this function exchanges that code for tokens and prints the
// refresh token for you to paste into the STRAVA_REFRESH_TOKEN env var.

export const handler = async (event) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return html(`<h2>Missing config</h2><p>Set <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> in your Netlify environment variables, then redeploy.</p>`);
  }

  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  const redirectUri = `${proto}://${host}/.netlify/functions/strava-auth`;
  const code = event.queryStringParameters && event.queryStringParameters.code;

  // Step 1: no code yet -> send the user to Strava's consent screen.
  if (!code) {
    const authUrl =
      'https://www.strava.com/oauth/authorize' +
      `?client_id=${clientId}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&approval_prompt=force' +
      '&scope=activity:read_all';
    return { statusCode: 302, headers: { Location: authUrl }, body: '' };
  }

  // Step 2: exchange the authorization code for tokens.
  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await res.json();
    if (!data.refresh_token) {
      return html(`<h2>Token exchange failed</h2><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }
    const who = data.athlete ? `${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim() : 'athlete';
    return html(`
      <h2>Connected — ${escapeHtml(who)}</h2>
      <p>Copy this value into the <code>STRAVA_REFRESH_TOKEN</code> environment variable in Netlify, then redeploy:</p>
      <pre style="user-select:all;padding:14px;background:#111;color:#0f0;border-radius:8px;font-size:16px;">${escapeHtml(data.refresh_token)}</pre>
      <p>After redeploying you can delete this step; the dashboard will fetch your runs automatically.</p>
    `);
  } catch (err) {
    return html(`<h2>Error</h2><pre>${escapeHtml(String(err))}</pre>`);
  }
};

function html(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.6;">${body}</body>`,
  };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
