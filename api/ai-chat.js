// Vercel Serverless Function: /api/ai-chat
// OPENAI_API_KEY must be configured as a server-side environment variable.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1500;
const AUTH_TIMEOUT_MS = 5000;
const OPENAI_TIMEOUT_MS = 20000;

// Supabase project URL and publishable key are public client configuration,
// matching the existing browser client. They are not service-role secrets.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hmcsgkavqdsfwqomxakw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_I2FLI3drU7_xB8tWWGjnOg_b6Sm2j2m';

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function contentLength(req) {
  const value = header(req, 'content-length');
  if (value === undefined) return null;
  if (!/^\d+$/.test(String(value))) return NaN;
  return Number(value);
}

function parseBody(req) {
  const raw = req.body;
  if (raw === undefined || raw === null) return { error: 'empty' };

  let body;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { error: 'too_large' };
    try {
      body = JSON.parse(text);
    } catch {
      return { error: 'invalid_json' };
    }
  } else {
    // Vercel's Node runtime may parse JSON before invoking the handler. Check
    // its encoded size as soon as the parsed body reaches this function.
    try {
      if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_BODY_BYTES) return { error: 'too_large' };
    } catch {
      return { error: 'invalid_json' };
    }
    body = raw;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_json' };
  return { body };
}

function validateMessages(body) {
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return null;
    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    messages.push({ role: message.role, content });
  }
  if (messages[messages.length - 1].role !== 'user') return null;
  return messages;
}

// Equivalent to Supabase Auth's auth.getUser(token): ask Auth to validate the
// bearer JWT and return the user associated with that verified token.
async function getUser(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user && typeof user.id === 'string' ? user : null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'الطريقة غير مسموحة.' });
  }

  const type = String(header(req, 'content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') return sendJson(res, 415, { error: 'نوع المحتوى غير مدعوم.' });

  const declaredLength = contentLength(req);
  if (Number.isNaN(declaredLength)) return sendJson(res, 400, { error: 'تعذر قراءة الطلب.' });
  if (declaredLength !== null && declaredLength > MAX_BODY_BYTES) {
    return sendJson(res, 413, { error: 'حجم الطلب أكبر من المسموح.' });
  }

  const parsed = parseBody(req);
  if (parsed.error === 'too_large') return sendJson(res, 413, { error: 'حجم الطلب أكبر من المسموح.' });
  if (parsed.error) return sendJson(res, 400, { error: 'الطلب غير صالح.' });

  const messages = validateMessages(parsed.body);
  if (!messages) return sendJson(res, 400, { error: 'الرسائل غير صالحة أو تجاوزت الحدود المسموحة.' });

  const authorization = String(header(req, 'authorization') || '');
  let user = null;
  if (authorization) {
    const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return sendJson(res, 401, { error: 'جلسة الدخول غير صالحة.' });
    try {
      user = await getUser(match[1]);
    } catch {
      return sendJson(res, 503, { error: 'تعذر التحقق من جلسة الدخول حالياً.' });
    }
    if (!user) return sendJson(res, 401, { error: 'جلسة الدخول غير صالحة أو منتهية.' });
  }
  // No bearer token intentionally remains a supported guest request.
  // No in-memory rate counter is used; distributed limiting is deferred.
  void user;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: 'المساعد غير متاح حالياً.' });

  const instructions = 'أنت مساعد القيمنق الرسمي داخل سوق القيمنق السعودي. أجب بالعربية الواضحة وبأسلوب ودود ومفيد، وركّز على الألعاب وأجهزة القيمنق والكمبيوتر والإلكترونيات والتسوق الآمن. إذا لم تعرف الإجابة فقل ذلك بوضوح.';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        instructions,
        input: messages,
        max_output_tokens: 500
      }),
      signal: controller.signal
    });

    let data;
    try {
      data = await upstream.json();
    } catch {
      return sendJson(res, 502, { error: 'تعذر الحصول على رد من المساعد الآن. حاول بعد قليل.' });
    }
    if (!upstream.ok) {
      console.error('OpenAI request failed:', upstream.status);
      return sendJson(res, 502, { error: 'تعذر الحصول على رد من المساعد الآن. حاول بعد قليل.' });
    }
    const reply = data.output_text || (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text)
      .join('\n');
    return sendJson(res, 200, { reply: reply || 'لم أتمكن من إعداد إجابة. أعد صياغة سؤالك.' });
  } catch (error) {
    if (error?.name === 'AbortError') return sendJson(res, 504, { error: 'استغرق المساعد وقتاً أطول من المتوقع. حاول مرة أخرى.' });
    console.error('AI chat request failed.');
    return sendJson(res, 500, { error: 'حدث خطأ داخلي. حاول مرة أخرى.' });
  } finally {
    clearTimeout(timeout);
  }
}
