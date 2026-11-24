const { json, authUser, db } = require('./_gaming-live-agora');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const user = await authUser(req); if (!user?.id) return json(res, 401, { error: 'يجب تسجيل الدخول.' });
    const id = String(req.body?.session_id || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'معرف البث غير صالح.' });
    const rows = await db(`stream_sessions?id=eq.${encodeURIComponent(id)}&select=id,host_user_id,provider&limit=1`); const s = rows?.[0];
    if (!s) return json(res, 404, { error: 'البث غير موجود.' });
    let allowed = s.host_user_id === user.id;
    if (!allowed) { const roles = await db(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&role=in.(owner,admin)&select=role&limit=1`); allowed = !!roles?.length; }
    if (!allowed) return json(res, 403, { error: 'لا تملك صلاحية إنهاء هذا البث.' });
    await db(`stream_sessions?id=eq.${encodeURIComponent(id)}`, 'PATCH', { status: 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return json(res, 200, { success: true, message: 'تم إنهاء جلسة Gaming Live.' });
  } catch (e) { console.error('gaming-live-stop:', e); return json(res, 500, { error: e.message || 'خطأ داخلي.' }); }
};
