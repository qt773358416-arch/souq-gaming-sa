// Vercel Serverless Function: /api/ai-chat
// Keep OPENAI_API_KEY in Vercel Project Settings > Environment Variables.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'المساعد يحتاج إعداد مفتاح الخدمة في إعدادات الخادم أولاً.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    const safe = messages
      .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.trim().slice(0, 1500) }))
      .filter(m => m.content);
    if (!safe.length || safe[safe.length - 1].role !== 'user') return res.status(400).json({ error: 'اكتب سؤالك أولاً.' });
    const instructions = `أنت مساعد القيمنق الرسمي داخل سوق القيمنق السعودي، تتحدث بالعربية الواضحة وبأسلوب ودود ومختصر. اختصاصك: أجهزة الكمبيوتر والقيمنق، المعالجات وكروت الشاشة والرامات والتخزين والشاشات، أجهزة PlayStation وXbox، الألعاب الرقمية وكروت الشحن والإكسسوارات، مساعدة المستخدم في فهم الإعلانات والمقارنة بين المواصفات، شرح خطوات نشر الإعلان والبيع والشراء واستخدام حسابه ومتجره داخل السوق. عمولة السوق المعتمدة على عمليات السوق هي 2%، ولا تخلطها مع رسوم بوابة الدفع أو الضرائب. لا تدّع أنك ترى الإعلانات أو الأسعار أو المخزون أو حالة الطلبات الحية؛ لا توجد لك حالياً وصلة استعلام مباشرة بقاعدة بيانات السوق. إذا سأل المستخدم عن إعلان أو سعر حالي، اطلب منه رابط الإعلان أو تفاصيله، ووضح أنك لا تستطيع تأكيد التوفر دون بيانات الإعلان. لا تخترع سياسات أو وسائل دفع أو ضمانات غير مذكورة. لا تطلب كلمات مرور أو رموز تحقق أو بيانات بطاقات. لا تقدم وعوداً بتنفيذ عمليات شراء أو تعديل حسابات. أعطِ خطوات عملية واضحة، واسأل سؤال توضيح واحداً فقط عند الحاجة.`;
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.5', instructions, input: safe, max_output_tokens: 500 })
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('OpenAI API error:', upstream.status, data?.error?.type || 'unknown');
      return res.status(502).json({ error: 'تعذر الحصول على رد من المساعد الآن. حاول بعد قليل.' });
    }
    const reply = data.output_text || (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
    return res.status(200).json({ reply: reply || 'لم أتمكن من إعداد إجابة. أعد صياغة سؤالك.' });
  } catch (error) {
    console.error('AI chat handler error:', error?.message || error);
    return res.status(500).json({ error: 'حدث خطأ داخلي. حاول مرة أخرى.' });
  }
}
