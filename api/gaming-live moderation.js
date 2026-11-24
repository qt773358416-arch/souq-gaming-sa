const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(body);
const env=n=>process.env[n];
const base=()=>String(env('SUPABASE_URL')||'').replace(/\/$/,'');
async function auth(req){
 const h=req.headers.authorization||'';
 if(!h.startsWith('Bearer '))return null;
 const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:h}});
 return r.ok?r.json():null;
}
async function db(path,method='GET',body){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const r=await fetch(`${base()}/rest/v1/${path}`,{
  method,
  headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Accept-Profile':'gaming_live','Content-Profile':'gaming_live',Prefer:'return=representation'},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const t=await r.text();let j;try{j=t?JSON.parse(t):null}catch{j=null}
 if(!r.ok)throw new Error(j?.message||`Database error ${r.status}`);
 return j;
}
module.exports=async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
 for(const n of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(!env(n))return send(res,503,{error:`إعداد الخادم ناقص: ${n}`});
 try{
  const user=await auth(req);
  if(!user?.id)return send(res,401,{error:'سجّل الدخول أولاً.'});
  if(req.method==='GET'){
   const sid=String(req.headers['x-stream-id']||'');
   if(!/^[0-9a-f-]{36}$/i.test(sid))return send(res,400,{error:'معرف البث غير صالح.'});
   const stream=(await db(`stream_sessions?id=eq.${encodeURIComponent(sid)}&select=id,host_user_id&limit=1`))?.[0];
   if(!stream)return send(res,404,{error:'البث غير موجود.'});
   const roles=await db(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&role=in.(owner,admin,moderator)&select=role&limit=1`);
   const canModerate=stream.host_user_id===user.id||!!roles?.length;
   return send(res,200,{can_moderate:canModerate,role:stream.host_user_id===user.id?'host':(roles?.[0]?.role||'viewer')});
  }
  const {action,session_id,message_id,reason='مخالفة إرشادات المحادثة'}=req.body||{};
  if(action!=='hide_message')return send(res,400,{error:'الإجراء غير معروف.'});
  if(!/^[0-9a-f-]{36}$/i.test(String(session_id||''))||!/^[0-9a-f-]{36}$/i.test(String(message_id||'')))return send(res,400,{error:'معرف البث أو التعليق غير صالح.'});
  const why=String(reason).trim().slice(0,1000);
  if(why.length<3)return send(res,400,{error:'سبب الإجراء قصير جداً.'});
  const stream=(await db(`stream_sessions?id=eq.${encodeURIComponent(session_id)}&select=id,host_user_id&limit=1`))?.[0];
  if(!stream)return send(res,404,{error:'البث غير موجود.'});
  const roles=await db(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&role=in.(owner,admin,moderator)&select=role&limit=1`);
  if(stream.host_user_id!==user.id&&!roles?.length)return send(res,403,{error:'لا تملك صلاحية الإشراف على هذا البث.'});
  const message=(await db(`stream_messages?id=eq.${encodeURIComponent(message_id)}&session_id=eq.${encodeURIComponent(session_id)}&select=id,user_id,state&limit=1`))?.[0];
  if(!message)return send(res,404,{error:'التعليق غير موجود في هذا البث.'});
  if(message.state!=='visible')return send(res,200,{success:true,message:'التعليق مخفي بالفعل.'});
  await db(`stream_messages?id=eq.${encodeURIComponent(message_id)}&session_id=eq.${encodeURIComponent(session_id)}`,'PATCH',{state:'hidden'});
  await db('moderation_actions','POST',{moderator_user_id:user.id,target_user_id:message.user_id,session_id,action:'hide_message',reason:why});
  return send(res,200,{success:true,message:'تم إخفاء التعليق.'});
 }catch(e){console.error('gaming-live-moderation',e);return send(res,500,{error:e.message||'خطأ داخلي.'});}
};
