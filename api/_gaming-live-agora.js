const env = (name) => process.env[name];
const base = () => (env('SUPABASE_URL') || '').replace(/\/$/, '');
const json = (res, status, body) => res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').json(body);
async function authUser(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: authorization } });
  return response.ok ? response.json() : null;
}
async function db(path, method = 'GET', body) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${base()}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Profile': 'gaming_live', 'Content-Profile': 'gaming_live', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase error ${response.status}`);
  return data;
}
function issueRtcToken(channelName, uid, publisher) {
  const appId = env('AGORA_APP_ID');
  const certificate = env('AGORA_APP_CERTIFICATE');
  if (!appId || !certificate) throw new Error('Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Agora ØºÙØ± ÙÙØªÙÙØ© Ø¹ÙÙ Ø§ÙØ®Ø§Ø¯Ù.');
  // Agora AccessToken2 builder. The certificate is only read in this server-side module.
  const mod = require('agora-token/src/RtcTokenBuilder2');
  const Builder = mod.RtcTokenBuilder2;
  const Role = mod.Role || Builder.Role;
  if (!Builder || !Role) throw new Error('ØªØ¹Ø°Ø± ØªØ­ÙÙÙ ÙÙÙÙØ¯ Agora AccessToken2.');
  const expiration = 3600;
  const token = Builder.buildTokenWithUid(appId, certificate, channelName, uid, publisher ? Role.ROLE_PUBLISHER : Role.ROLE_SUBSCRIBER, expiration, expiration);
  if (!token) throw new Error('ØªØ¹Ø°Ø± Ø¥ÙØ´Ø§Ø¡ Ø±ÙØ² Agora.');
  return { appId, token, expiresIn: expiration };
}
module.exports = { env, json, authUser, db, issueRtcToken };
