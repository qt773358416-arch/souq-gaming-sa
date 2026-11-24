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
  if (!appId || !certificate) throw new Error('إعدادات Agora غير مكتملة على الخادم.');
  // Agora AccessToken2 builder. The certificate is only read in this server-side module.
  // Official agora-token Node.js API exports RtcTokenBuilder and Role.
  const { RtcTokenBuilder, Role } = require('agora-token/src/RtcTokenBuilder2');
  if (!RtcTokenBuilder || !Role) throw new Error('تعذر تحميل مولّد Agora AccessToken2.');
  const expiration = 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    certificate,
    channelName,
    uid,
    publisher ? Role.PUBLISHER : Role.SUBSCRIBER,
    expiration,
    expiration
  );
  if (!token) throw new Error('تعذر إنشاء رمز Agora.');
  return { appId, token, expiresIn: expiration };
}
module.exports = { env, json, authUser, db, issueRtcToken };
