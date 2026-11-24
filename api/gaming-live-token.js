const { env, json, authUser, db, issueRtcToken } = require('./_gaming-live-agora');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const user = await authUser(req);
    if (!user?.id) return json(res, 401, { error: 'يجب تسجيل الدخول.' });
    const id = String(req.body?.session_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'معرف البث غير صالح.' });
    const rows = await db(`stream_sessions?id=eq.${encodeURIComponent(id)}&select=id,host_user_id,status,provider,provider_input_id,playback_uid&limit=1`);
    const s = rows?.[0];
    if (!s || s.provider !== 'agora_rtc' || !s.provider_input_id) return json(res, 404, { error: 'جلسة البث غير موجودة.' });
    const publisher = s.host_user_id === user.id;
    if (publisher) {
      const profiles = await db(`player_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=state,can_stream,stream_access_status`);
      const p = profiles?.[0];
      if (!p || p.state !== 'active' || p.can_stream !== true || p.stream_access_status !== 'approved') return json(res, 403, { error: 'صلاحية البث غير معتمدة.' });
      if (!['created','ready','live','reconnecting'].includes(s.status)) return json(res, 409, { error: 'جلسة البث منتهية.' });
    } else if (s.status !== 'live') return json(res, 403, { error: 'هذا البث غير متاح للمشاهدة حاليًا.' });
    const uid = Number.parseInt(user.id.replace(/-/g, '').slice(0, 8), 16) || 1;
    const out = issueRtcToken(s.provider_input_id, uid, publisher);
    return json(res, 200, { success: true, app_id: out.appId, token: out.token, channel: s.provider_input_id, uid, role: publisher ? 'publisher' : 'audience', token_expires_in: out.expiresIn });
  } catch (e) { console.error('gaming-live-token:', e); return json(res, 500, { error: e.message || 'تعذر إصدار رمز المشاهدة.' }); }
};
