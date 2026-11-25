'use strict';
const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(body);
const env=n=>process.env[n];
const base=()=>String(env('SUPABASE_URL')||'').replace(/\/$/,'');
async function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:h}});return r.ok?r.json():null;}
async function db(path){const key=env('SUPABASE_SERVICE_ROLE_KEY');const r=await fetch(`${base()}/rest/v1/${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`,'Accept-Profile':'gaming_live'}});const t=await r.text();let j;try{j=t?JSON.parse(t):null}catch{j=null}if(!r.ok)throw new Error(j?.message||`Database error ${r.status}`);return j;}
const restrictive=a=>['mute','ban','block','كتم','حظر','منع'].some(v=>String(a||'').toLowerCase().includes(v));
module.exports=async(req,res)=>{
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 for(const n of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(!env(n))return send(res,503,{error:`إعداد الخادم ناقص: ${n}`});
 try{
  const user=await auth(req);if(!user?.id)return send(res,401,{error:'سجّل الدخول أولاً.'});
  const roles=await db(`staff_roles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=role&limit=10`);
  if(!(roles||[]).some(x=>['owner','admin'].includes(String(x.role).toLowerCase())))return send(res,403,{error:'التنبيهات متاحة لمالك المنصة أو مديرها فقط.'});
  const rows=await db('moderation_actions?select=moderator_user_id,target_user_id,session_id,action,created_at&order=created_at.desc&limit=2000');
  const now=Date.now(),windowMs=600000,byMod=new Map();
  for(const row of rows||[]){if(!row.moderator_user_id||!row.created_at)continue;const ts=Date.parse(row.created_at);if(!Number.isFinite(ts)||now-ts>windowMs||ts>now+60000)continue;const id=row.moderator_user_id;if(!byMod.has(id))byMod.set(id,{all:[],restrictive:[],targets:new Map(),last:null});const g=byMod.get(id);g.all.push(row);if(restrictive(row.action))g.restrictive.push(row);if(row.target_user_id)g.targets.set(row.target_user_id,(g.targets.get(row.target_user_id)||[]).concat(row));if(!g.last||ts>Date.parse(g.last))g.last=row.created_at;}
  const alerts=[];for(const [id,g] of byMod){if(g.restrictive.length>=5)alerts.push({moderator_user_id:id,title:'تكرار إجراءات الكتم أو الحظر',detail:`${g.restrictive.length} إجراء تقييدي خلال آخر 10 دقائق.`,window_label:'آخر 10 دقائق',last_action:g.last});if(g.all.length>=10)alerts.push({moderator_user_id:id,title:'ارتفاع عدد إجراءات الإشراف',detail:`${g.all.length} إجراء إشرافي خلال آخر 10 دقائق.`,window_label:'آخر 10 دقائق',last_action:g.last});for(const [target,items] of g.targets)if(items.length>=3)alerts.push({moderator_user_id:id,title:'تكرار الإجراءات على لاعب واحد',detail:`${items.length} إجراءات على اللاعب ${target} خلال آخر 10 دقائق.`,window_label:'آخر 10 دقائق',last_action:items[0].created_at});}
  alerts.sort((a,b)=>Date.parse(b.last_action||0)-Date.parse(a.last_action||0));
  return send(res,200,{alerts,records_examined:(rows||[]).length,limit:2000,window_minutes:10,generated_at:new Date().toISOString(),note:'هذه مؤشرات للمراجعة وليست إثباتاً للمخالفة.'});
 }catch(e){console.error('gaming-live-moderator-alerts',e);return send(res,500,{error:e.message||'خطأ داخلي.'});}
};
