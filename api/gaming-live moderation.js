
const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(body);
const env=n=>process.env[n];
const base=()=>String(env('SUPABASE_URL')||'').replace(/\/$/,'');

async function auth(req){
 const h=req.headers.authorization||'';
 if(!h.startsWith('Bearer '))return null;
 const r=await fetch(`${base()}/auth/v1/user`,{
  headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:h}
 });
 return r.ok?r.json():null;
}

async function db(path,method='GET',body){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const r=await fetch(`${base()}/rest/v1/${path}`,{
  method,
  headers:{
   apikey:key,
   Authorization:`Bearer ${key}`,
   'Content-Type':'application/json',
   'Accept-Profile':'gaming_live',
   'Content-Profile':'gaming_live',
   Prefer:'return=representation'
  },
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const t=await r.text();
 let j;
 try{j=t?JSON.parse(t):null}catch{j=null}
 if(!r.ok)throw new Error(j?.message||`Database error ${r.status}`);
 return j;
}

const validId=v=>/^[0-9a-f-]{36}$/i.test(String(v||''));

async function getStream(session_id){
 return (await db(`stream_sessions?id=eq.${encodeURIComponent(session_id)}&select=id,host_user_id&limit=1`))?.[0]||null;
}

async function isModerator(userId,stream){
 if(stream.host_user_id===userId)return true;

 const scoped=await db(
  `stream_moderators?session_id=eq.${encodeURIComponent(stream.id)}&user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null&select=user_id&limit=1`
 );

 if(scoped?.length)return true;

 const roles=await db(
  `staff_roles?user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&role=in.(owner,admin,moderator)&select=role&limit=1`
 );

 return !!roles?.length;
}

async function activeRestrictions(sessionId,userId){
 const rows=await db(
  `moderation_actions?session_id=eq.${encodeURIComponent(sessionId)}&target_user_id=eq.${encodeURIComponent(userId)}&action=in.(mute_user,block_user)&select=action,expires_at,created_at&order=created_at.desc&limit=100`
 );

 const now=Date.now();

 return (rows||[]).filter(x=>
  !x.expires_at||new Date(x.expires_at).getTime()>now
 );
}

module.exports=async(req,res)=>{
 if(!['GET','POST'].includes(req.method))
  return send(res,405,{error:'Method not allowed'});

 for(const n of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']){
  if(!env(n))return send(res,503,{error:`إعداد الخادم ناقص: ${n}`});
 }

 try{
  const user=await auth(req);

  if(!user?.id)
   return send(res,401,{error:'سجّل الدخول أولاً.'});

  if(req.method==='GET'){
   const sid=String(req.headers['x-stream-id']||'');

   if(!validId(sid))
    return send(res,400,{error:'معرف البث غير صالح.'});

   const stream=await getStream(sid);

   if(!stream)
    return send(res,404,{error:'البث غير موجود.'});

   const canModerate=await isModerator(user.id,stream);

   if(req.headers['x-moderation-list']==='1'){
    if(!canModerate)
     return send(res,403,{error:'لا تملك صلاحية عرض قائمة القيود.'});

    const rows=await db(
     `moderation_actions?session_id=eq.${encodeURIComponent(sid)}&action=in.(mute_user,block_user)&select=id,target_user_id,action,reason,expires_at,created_at&order=created_at.desc&limit=500`
    );

    const now=Date.now();
    const seen=new Set();
    const restrictions=[];

    for(const row of (rows||[])){
     if(row.expires_at&&new Date(row.expires_at).getTime()<=now)continue;

     const key=row.target_user_id+':'+row.action;

     if(seen.has(key))continue;

     seen.add(key);
     restrictions.push(row);
    }

    return send(res,200,{can_moderate:true,restrictions});
   }

   const restrictions=await activeRestrictions(sid,user.id);
   const block=restrictions.find(x=>x.action==='block_user');
   const mute=restrictions.find(x=>x.action==='mute_user');

   return send(res,200,{
    can_moderate:canModerate,
    is_host:stream.host_user_id===user.id,
    role:stream.host_user_id===user.id?'host':(canModerate?'moderator':'viewer'),
    my_restriction:block
     ?{blocked:true,muted:false,expires_at:block.expires_at}
     :mute
      ?{blocked:false,muted:true,expires_at:mute.expires_at}
      :null
   });
  }

  const {
   action,
   session_id,
   message_id,
   target_user_id,
   reason='مخالفة إرشادات البث',
   duration_minutes
  }=req.body||{};

  if(!validId(session_id))
   return send(res,400,{error:'معرف البث غير صالح.'});

  const stream=await getStream(session_id);

  if(!stream)
   return send(res,404,{error:'البث غير موجود.'});

  if(!(await isModerator(user.id,stream)))
   return send(res,403,{error:'لا تملك صلاحية الإشراف على هذا البث.'});

  const why=String(reason||'').trim().slice(0,1000);

  if(why.length<3)
   return send(res,400,{error:'اكتب سبباً من 3 أحرف على الأقل.'});

  if(action==='hide_message'){
   if(!validId(message_id))
    return send(res,400,{error:'معرف التعليق غير صالح.'});

   const message=(await db(
    `stream_messages?id=eq.${encodeURIComponent(message_id)}&session_id=eq.${encodeURIComponent(session_id)}&select=id,user_id,state&limit=1`
   ))?.[0];

   if(!message)
    return send(res,404,{error:'التعليق غير موجود في هذا البث.'});

   if(message.state!=='visible')
    return send(res,200,{success:true,message:'التعليق مخفي بالفعل.'});

   await db(
    `stream_messages?id=eq.${encodeURIComponent(message_id)}&session_id=eq.${encodeURIComponent(session_id)}`,
    'PATCH',
    {state:'hidden'}
   );

   await db('moderation_actions','POST',{
    moderator_user_id:user.id,
    target_user_id:message.user_id,
    session_id,
    action:'hide_message',
    reason:why
   });

   return send(res,200,{success:true,message:'تم إخفاء التعليق.'});
  }

  if(!['mute_user','block_user','unmute_user','unblock_user'].includes(action))
   return send(res,400,{error:'الإجراء غير معروف.'});

  if(!validId(target_user_id))
   return send(res,400,{error:'معرف اللاعب المستهدف غير صالح.'});

  if(target_user_id===user.id||target_user_id===stream.host_user_id)
   return send(res,400,{error:'لا يمكن تطبيق هذا الإجراء على حسابك أو على صاحب البث.'});

  const now=new Date().toISOString();

  if(action==='mute_user'||action==='block_user'){
   let expires_at=null;

   if(action==='mute_user'){
    const mins=Number(duration_minutes);

    if(!Number.isInteger(mins)||mins<1||mins>1440)
     return send(res,400,{error:'مدة الكتم يجب أن تكون من 1 إلى 1440 دقيقة.'});

    expires_at=new Date(Date.now()+mins*60000).toISOString();

   }else if(duration_minutes!==null&&duration_minutes!==undefined){
    const mins=Number(duration_minutes);

    if(!Number.isInteger(mins)||mins<1||mins>43200)
     return send(res,400,{error:'مدة الحظر يجب أن تكون من دقيقة إلى 30 يوماً، أو null للحظر المفتوح.'});

    expires_at=new Date(Date.now()+mins*60000).toISOString();
   }

   const kind=action==='mute_user'?'الكتم':'الحظر';

   const prior=`moderation_actions?session_id=eq.${encodeURIComponent(session_id)}&target_user_id=eq.${encodeURIComponent(target_user_id)}&action=eq.${action}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`;

   await db(prior,'PATCH',{expires_at:now});

   await db('moderation_actions','POST',{
    moderator_user_id:user.id,
    target_user_id,
    session_id,
    action,
    reason:why,
    expires_at
   });

   return send(res,200,{
    success:true,
    message:expires_at
     ?`تم ${kind} اللاعب حتى ${new Date(expires_at).toLocaleString('ar-SA')}.`
     :`تم حظر اللاعب من التعليق في هذا البث حتى إلغاء الحظر.`
   });
  }

  const activeAction=action==='unmute_user'?'mute_user':'block_user';

  const filter=`moderation_actions?session_id=eq.${encodeURIComponent(session_id)}&target_user_id=eq.${encodeURIComponent(target_user_id)}&action=eq.${activeAction}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`;

  await db(filter,'PATCH',{expires_at:now});

  await db('moderation_actions','POST',{
   moderator_user_id:user.id,
   target_user_id,
   session_id,
   action,
   reason:why,
   expires_at:now
  });

  return send(res,200,{
   success:true,
   message:action==='unmute_user'
    ?'تم رفع الكتم عن اللاعب.'
    :'تم رفع الحظر عن اللاعب.'
  });

 }catch(e){
  console.error('gaming-live-moderation',e);
  return send(res,500,{error:e.message||'خطأ داخلي.'});
 }
};
