const { env, json, authUser, db, issueRtcToken } = require('./_gaming-live-agora');
const uuid = () => require('crypto').randomUUID();
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  for (const name of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','AGORA_APP_ID','AGORA_APP_CERTIFICATE']) if (!env(name)) return json(res, 503, { error: `إعداد الخادم ناقص: ${name}` });
  try {
    const user = await authUser(req);
    if (!user?.id) return json(res, 401, { error: 'يجب تسجيل الدخول إلى سوق القيمنق أولاً.' });
    const { title, description = '', category_id = null } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120) return json(res, 400, { error: 'عنوان البث يجب أن يكون بين 3 و120 حرفًا.' });
    if (typeof description !== 'string' || description.length > 1000) return json(res, 400, { error: 'الوصف أطول من الحد المسموح.' });
    const profiles = await db(`player_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,state,can_stream,stream_access_status`);
    const profile = profiles?.[0];
    if (!profile || profile.state !== 'active' || profile.can_stream !== true || profile.stream_access_status !== 'approved') return json(res, 403, { error: 'حسابك غير معتمد للبث. راجع إدارة Gaming Live.' });
    const existing = await db(`stream_sessions?host_user_id=eq.${encodeURIComponent(user.id)}&status=in.(created,ready,live,reconnecting)&select=id,status&limit=1`);
    if (existing?.length) return json(res, 409, { error: 'لديك جلسة بث قائمة بالفعل.', session_id: existing[0].id });
    if (category_id) {
      const categories = await db(`game_categories?id=eq.${encodeURIComponent(category_id)}&is_active=eq.true&select=id&limit=1`);
      if (!categories?.length) return json(res, 400, { error: 'تصنيف اللعبة غير صالح أو غير نشط.' });
    }
    const sessionId = uuid();
    const channelName = `gl_${sessionId.replace(/-/g, '')}`;
    const uid = Number.parseInt(user.id.replace(/-/g, '').slice(0, 8), 16) || 1;
    const credentials = issueRtcToken(channelName, uid, true);
    const inserted = await db('stream_sessions', 'POST', {
      id: sessionId, host_user_id: user.id, category_id, title: title.trim(), description: description.trim(),
      status: 'created', provider: 'agora_rtc', provider_input_id: channelName, playback_uid: String(uid), playback_url: null
    });
    if (!inserted?.[0]) throw new Error('لم يتم إنشاء سجل جلسة البث.');
    return json(res, 201, { success: true, provider: 'agora_rtc', session_id: sessionId, channel: channelName, uid, app_id: credentials.appId, token: credentials.token, token_expires_in: credentials.expiresIn, role: 'publisher', message: 'تم تجهيز جلسة Agora. اضغط بدء البث للسماح للمتصفح باستخدام الكاميرا والميكروفون.' });
  } catch (error) {
    console.error('gaming-live-start:', error);
    return json(res, 500, { error: error.message || 'حدث خطأ أثناء تجهيز البث.' });
  }
};
