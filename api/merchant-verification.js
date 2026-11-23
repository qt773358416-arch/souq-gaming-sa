// Server-side assessment for merchant verification readiness.
// This endpoint deliberately does NOT claim to verify identity, CR, freelance status,
// e-commerce certification, or bank ownership. Real checks require contracted providers
// and their documented API adapters to be implemented and enabled.

const CHECKS = {
  identity: { label: 'الهوية الوطنية / الإقامة', providers: ['nafath'] },
  commercial_registration: { label: 'السجل التجاري', providers: ['commerce'] },
  freelance_document: { label: 'وثيقة العمل الحر', providers: ['commerce'] },
  ecommerce_certificate: { label: 'شهادة توثيق التجارة الإلكترونية', providers: ['commerce'] },
  bank_account: { label: 'ملكية الحساب البنكي', providers: ['lean', 'tarabut', 'spare'] },
};

const STATUS_LABELS = {
  provider_unavailable: 'مزود التحقق غير مربوط أو الموصل غير مفعّل',
  manual_review: 'يلزم إعداد تكامل المزود واختباره قبل التحقق الرسمي',
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

function safeEqualOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser/internal callers are still authenticated below.
  const allowed = (process.env.ALLOWED_APP_ORIGINS || process.env.APP_ORIGIN || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host || '').toLowerCase();
    return parsed.host.toLowerCase() === host && ['https:', 'http:'].includes(parsed.protocol);
  } catch { return false; }
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error('إعدادات الخادم ناقصة. أضف SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY في متغيرات Vercel.');
  }
  return { url, anonKey, serviceKey };
}

async function sbFetch(config, path, { method = 'GET', token, body, prefer } = {}) {
  const headers = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = data && typeof data === 'object' ? (data.message || data.error || data.hint) : data;
    throw new Error(`تعذر تنفيذ عملية قاعدة البيانات (${response.status}): ${message || 'خطأ غير محدد'}`);
  }
  return data;
}

async function authenticateOwner(req, config) {
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('يلزم تسجيل الدخول.'), { status: 401 });
  const token = match[1];
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Object.assign(new Error('جلسة الدخول غير صالحة أو انتهت.'), { status: 401 });
  const user = await response.json();
  if (!user?.id) throw Object.assign(new Error('تعذر تحديد المستخدم المسجل.'), { status: 401 });
  const admins = await sbFetch(config,
    `/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,role&limit=5`);
  const isOwner = Array.isArray(admins) && admins.some(row => String(row.role || '').toLowerCase() === 'owner');
  if (!isOwner) throw Object.assign(new Error('هذه العملية متاحة لمالك المنصة فقط.'), { status: 403 });
  return { user, token };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    if (!safeEqualOrigin(req)) return send(res, 403, { error: 'مصدر الطلب غير مسموح.' });
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'طريقة الطلب غير مدعومة.' });
  if (!safeEqualOrigin(req)) return send(res, 403, { error: 'مصدر الطلب غير مسموح.' });

  try {
    const config = supabaseConfig();
    const { user } = await authenticateOwner(req, config);
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    if (body.action !== 'run_readiness') return send(res, 400, { error: 'العملية المطلوبة غير معروفة.' });
    const requestId = String(body.requestId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return send(res, 400, { error: 'رقم طلب التوثيق غير صالح.' });
    }

    const requests = await sbFetch(config,
      `/rest/v1/vendor_verification_requests?id=eq.${encodeURIComponent(requestId)}&select=id,user_id,merchant_type,status&limit=1`);
    const merchantRequest = Array.isArray(requests) ? requests[0] : null;
    if (!merchantRequest) return send(res, 404, { error: 'طلب التوثيق غير موجود.' });
    if (merchantRequest.status === 'verified') {
      return send(res, 409, { error: 'هذا الطلب موثق بالفعل؛ لا حاجة لإعادة تشغيل تقييم الجاهزية.' });
    }

    const providerRows = await sbFetch(config,
      '/rest/v1/verification_provider_registry?select=provider_key,provider_name,connection_status,capabilities&order=provider_name.asc');
    const providers = Array.isArray(providerRows) ? providerRows : [];
    const selectedTypes = merchantRequest.merchant_type === 'establishment'
      ? ['identity', 'commercial_registration', 'ecommerce_certificate', 'bank_account']
      : ['identity', 'freelance_document', 'ecommerce_certificate', 'bank_account'];

    const timestamp = new Date().toISOString();
    const inserts = selectedTypes.map(checkType => {
      const spec = CHECKS[checkType];
      const matches = providers.filter(p => spec.providers.includes(p.provider_key));
      const connected = matches.find(p => p.connection_status === 'connected');
      const sandbox = matches.find(p => p.connection_status === 'sandbox');
      const candidate = connected || sandbox || matches[0] || null;
      const status = 'provider_unavailable';
      let message;
      if (!matches.length) message = 'لا يوجد مزود مسجل لهذا الفحص في سجل مزودي الخدمة.';
      else if (connected) message = `المزود ${connected.provider_name} مسجل كمتصل، لكن موصل API الفعلي لم يُفعّل أو يُختبر؛ لم يتم إرسال بيانات التاجر لأي جهة.`;
      else if (sandbox) message = `المزود ${sandbox.provider_name} مضبوط على بيئة تجريبية؛ لا تُقبل نتائج البيئة التجريبية كتوثيق نهائي.`;
      else message = `المزود ${candidate.provider_name} غير مربوط حاليًا.`;
      return {
        request_id: merchantRequest.id,
        user_id: merchantRequest.user_id,
        check_type: checkType,
        status,
        provider_key: candidate?.provider_key || null,
        provider_reference: null,
        checked_at: timestamp,
        expires_at: null,
        safe_summary: {
          message,
          assessment: 'readiness_only',
          official_verification: false,
          triggered_by: user.id,
          checked_at: timestamp,
        },
      };
    });

    await sbFetch(config, '/rest/v1/vendor_verification_checks', {
      method: 'POST', body: inserts, prefer: 'return=minimal',
    });

    return send(res, 200, {
      ok: true,
      action: 'run_readiness',
      checkedAt: timestamp,
      checks: inserts.map(item => ({
        checkType: item.check_type,
        label: CHECKS[item.check_type].label,
        status: item.status,
        statusLabel: STATUS_LABELS[item.status],
        provider: item.provider_key,
        message: item.safe_summary.message,
      })),
      notice: 'هذا تقييم جاهزية فقط. لم يتم الاتصال بنفاذ أو وزارة التجارة أو أي بنك، ولم يتم التحقق رسميًا من المستندات أو ملكية الحساب البنكي. لن تتغير حالة الطلب إلى «موثق» بسبب هذا الإجراء.',
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return send(res, status, { error: status >= 500 ? 'تعذر إكمال تقييم الجاهزية. راجع إعدادات API وسجل Vercel.' : error.message });
  }
};
