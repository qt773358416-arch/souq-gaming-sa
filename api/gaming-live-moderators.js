const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(body);
const env=n=>process.env[n];
const base=()=>String(env('SUPABASE_URL')||'').replace(/\/$/,'');
const validId=v=>/^[0-9a-f-]{36}$/i.test(String(v||''));
async function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:h}});return r.ok?r.json():null;}
async function db(path,method='GET',body){const key=env('SUPABASE_SERVICE_ROLE_KEY');const r=await fetch(`${base()}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Accept-Profile':'gaming_live','Content-Profile':'gaming_live',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j;try{j=t?JSON.parse(t):null}catch{j=null}if(!r.ok)throw new Error(j?.message||`Database error ${r.status}`);return j;}
module.exports=async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
 for(const n of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(!env(n))return send(res,503,{error:`إعداد الخادم ناقص: ${n}`});
 try{
  const user=await auth(req);if(!user?.id)return send(res,401,{error:'سجّل الدخول أولاً.'});
  const sid=String(req.headers['x-stream-id']||(req.body||{}).session_id||'');if(!validId(sid))return send(res,400,{error:'معرّف البث غير صالح.'});
  const stream=(await db(`stream_sessions?id=eq.${encodeURIComponent(sid)}&select=id,host_user_id&limit=1`))?.[0];if(!stream)return send(res,404,{error:'البث غير موجود.'});
  if(stream.host_user_id!==user.id)return send(res,403,{error:'إدارة مشرفي البث متاحة لصاحب البث فقط.'});
  if(req.method==='GET'){
   const rows=await db(`stream_moderators?session_id=eq.${encodeURIComponent(sid)}&revoked_at=is.null&select=user_id,assigned_by,created_at&order=created_at.desc&limit=100`);
   return send(res,200,{moderators:rows||[]});
  }
  const {action,user_id}=req.body||{};if(!validId(user_id))return send(res,400,{error:'أدخل UUID صحيحاً لحساب المشرف.'});
  if(user_id===stream.host_user_id)return send(res,400,{error:'صاحب البث لا يحتاج إلى تعيين مشرف.'});
  if(action==='assign'){
   const existing=(await db(`stream_moderators?session_id=eq.${encodeURIComponent(sid)}&user_id=eq.${encodeURIComponent(user_id)}&revoked_at=is.null&select=user_id&limit=1`))||[];
   if(existing.length)return send(res,200,{success:true,message:'هذا الحساب مشرف بالفعل في البث.'});
   await db('stream_moderators','POST',{session_id:sid,user_id,assigned_by:user.id});
   return send(res,200,{success:true,message:'تم تعيين المشرف لهذا البث فقط.'});
  }
  if(action==='revoke'){
   await db(`stream_moderators?session_id=eq.${encodeURIComponent(sid)}&user_id=eq.${encodeURIComponent(user_id)}&revoked_at=is.null`,'PATCH',{revoked_at:new Date().toISOString()});
   return send(res,200,{success:true,message:'تم سحب صلاحية المشرف من هذا البث.'});
  }
  return send(res,400,{error:'الإجراء غير معروف.'});
 }catch(e){console.error('gaming-live-moderators',e);return send(res,500,{error:e.message||'خطأ داخلي.'});}
};
