const { json, authUser, db } = require('./_gaming-live-agora');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const user = await authUser(req); if (!user?.id) return json(res, 401, { error: 'يجب تسجيل الدخول.' });
    const id = String(req.body?.session_id || ''); const action = req.body?.action;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['live','ended'].includes(action)) return json(res, 400, { error: 'طلب الحالة غير صالح.' });
    const rows = await db(`stream_sessions?id=eq.${encodeURIComponent(id)}&host_user_id=eq.${encodeURIComponent(user.id)}&select=id,status,provider&limit=1`);
    if (!rows?.length || rows[0].provider !== 'agora_rtc') return json(res, 404, { error: 'جلسة البث غير موجودة.' });
    const patch = action === 'live' ? { status: 'live', started_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { status: 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await db(`stream_sessions?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
    return json(res, 200, { success: true, status: action });
  } catch (e) { console.error('gaming-live-status:', e); return json(res, 500, { error: e.message || 'تعذر تحديث حالة البث.' }); }
};
