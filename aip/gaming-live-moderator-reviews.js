'use strict';
const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(body);
const env=n=>process.env[n];
const base=()=>String(env('SUPABASE_URL')||'').replace(/\/$/,'');
const validId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
async function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:h}});return r.ok?r.json():null;}
async function db(path,method='GET',body){const key=env('SUPABASE_SERVICE_ROLE_KEY');const r=await fetch(`${base()}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Accept-Profile':'gaming_live','Content-Profile':'gaming_live',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j;try{j=t?JSON.parse(t):null}catch{j=null}if(!r.ok)throw new Error(j?.message||`Database error ${r.status}`);return j;}
const labels={approved:'معتمد',needs_review:'يحتاج مراجعة',revoked:'سُحبت صلاحيته من هذا البث'};
module.exports=async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
 for(const n of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(!env(n))return send(res,503,{error:`إعداد الخادم ناقص: ${n}`});
 try{
  const user=await auth(req);if(!user?.id)return send(res,401,{error:'سجّل الدخول أولاً.'});
  const roles=await db(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=role&limit=10`);
  if(!(roles||[]).some(x=>['owner','admin'].includes(String(x.role).toLowerCase())))return send(res,403,{error:'إدارة مراجعات المشرفين متاحة لمالك المنصة أو المدير النشط فقط.'});
  if(req.method==='GET'){
   const rows=await db('moderator_reviews?select=id,moderator_user_id,session_id,reviewer_user_id,decision,note,created_at&order=created_at.desc&limit=200');
   return send(res,200,{reviews:(rows||[]).map(x=>({...x,decision_label:labels[x.decision]||x.decision}))});
  }
  const b=req.body||{},moderator_user_id=String(b.moderator_user_id||''),session_id=String(b.session_id||''),decision=String(b.decision||''),note=String(b.note||'').trim();
  if(!validId(moderator_user_id)||!validId(session_id))return send(res,400,{error:'أدخل UUID صحيحاً للمشرف والبث.'});
  if(!Object.prototype.hasOwnProperty.call(labels,decision))return send(res,400,{error:'قرار المراجعة غير صالح.'});
  if(note.length>1000)return send(res,400,{error:'الملاحظات يجب ألا تتجاوز 1000 حرف.'});
  const assigned=await db(`stream_moderators?session_id=eq.${encodeURIComponent(session_id)}&user_id=eq.${encodeURIComponent(moderator_user_id)}&select=id,revoked_at&limit=1`);
  if(!assigned?.length)return send(res,404,{error:'لم يتم العثور على تعيين هذا المشرف في البث المحدد.'});
  if(decision==='revoked'&&!assigned[0].revoked_at){
   await db(`stream_moderators?id=eq.${encodeURIComponent(assigned[0].id)}`,'PATCH',{revoked_at:new Date().toISOString()});
  }
  const saved=await db('moderator_reviews','POST',{moderator_user_id,session_id,reviewer_user_id:user.id,decision,note:note||null});
  return send(res,200,{success:true,message:decision==='revoked'?'تم سحب صلاحية المشرف من هذا البث وتسجيل القرار.':'تم حفظ قرار المراجعة.',review:saved?.[0]||null});
 }catch(e){console.error('gaming-live-moderator-reviews',e);return send(res,500,{error:e.message||'خطأ داخلي.'});}
};
