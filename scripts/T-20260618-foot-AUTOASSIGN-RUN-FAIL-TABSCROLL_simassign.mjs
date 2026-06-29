/**
 * maybeAutoAssign read-path 시뮬레이션 (쓰기 안 함) — post-hotfix(display_name 제거) 코드 기준.
 * 오늘 미배정 treatment_waiting/consult_waiting 건에 대해 chosen(배정 대상)이 산출되는지 검증.
 * 산출되면 → 엔진 로직 정상, RC=hotfix와 동일(staff=[] 였던 게 원인) 확정.
 */
import { createClient } from '@supabase/supabase-js';
const URL='https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY=(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const FOOT='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const sb=createClient(URL,KEY,{auth:{persistSession:false}});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// duty parser (이식)
const REST=new Set(['휴진','휴무','오프','off','OFF','-','·','–','—']);
const pad2=n=>String(n).padStart(2,'0');
function pl(line){const o=[];let c='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){c+='"';i++;}else q=false;}else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c='';}else c+=ch;}o.push(c);return o;}
const pcsv=s=>s.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').map(pl);
const dn=c=>{const s=(c??'').toString().trim();if(!/^\d{1,2}$/.test(s))return null;const n=+s;return n>=1&&n<=31?n:null;};
const dcs=r=>{const o=[];r.forEach((c,i)=>{const d=dn(c);if(d!=null)o.push({col:i,day:d});});return o;};
function mh(r){let mo,yr,t;for(const cr of r){const c=(cr??'').toString().trim();if(!c)continue;const m=c.match(/^(\d{1,2})\s*월$/);if(m){mo=+m[1];continue;}const y=c.match(/^(20\d{2})$/);if(y){yr=+y[1];continue;}if(!/^[월화수목금토일]$/.test(c)&&!/^\d+$/.test(c)){if(!t||c.length>t.length)t=c;}}if(mo==null)return null;return{year:yr,month:mo,team:t};}
function rd(dc,sy,sm){let y=sy,m=sm,p=0;const md=new Map();for(const{col,day}of dc){if(p&&day<p){m++;if(m>12){m=1;y++;}}md.set(col,`${y}-${pad2(m)}-${pad2(day)}`);p=day;}return{md,ey:y,em:m};}
function ext(g){const n=new Date();let cy=n.getFullYear(),cm=n.getMonth()+1,t='';const cand=[];let i=0;while(i<g.length){const row=g[i]??[];const h=mh(row);if(h){if(h.year!=null)cy=h.year;if(h.month!=null)cm=h.month;if(h.team)t=h.team;i++;continue;}const dc=dcs(row);if(dc.length>=3){const{md,ey,em}=rd(dc,cy,cm);let j=i+1;for(;j<g.length;j++){const ar=g[j]??[];if(mh(ar))break;if(dcs(ar).length>=3)break;for(const[col,date]of md){const raw=(ar[col]??'').toString().trim();if(!raw||REST.has(raw))continue;cand.push({name:raw,date});}}cy=ey;cm=em;i=j;continue;}i++;}return cand;}

function consultAxis(c){if(c.visit_type==='returning')return 'returning';const raw=(c.visit_route??c.lead_source??'').trim();if(['TM','인바운드','워크인'].includes(raw))return raw;return '워크인';}
function therapyAxis(ci){const hay=`${ci.treatment_kind??''} ${ci.treatment_category??''}`.toLowerCase();if(hay.includes('podolog')||hay.includes('포돌'))return 'podologue';if(ci.status_flag==='green'||hay.includes('trial')||hay.includes('체험'))return 'trial';return 'main';}

async function main(){
  // staff (post-hotfix select: display_name 없음)
  const { data: staff, error: se } = await sb.from('staff')
    .select('id, clinic_id, name, role, active, created_at').eq('clinic_id',FOOT).eq('active',true);
  console.log('fetchActiveStaff error?', se?.message ?? 'OK', '→ staff', staff?.length, '명 (post-hotfix select)');

  // working ids (today)
  const { data: d } = await sb.functions.invoke('duty-sheet-read',{body:{gid:'341864863'}});
  const cand = ext(pcsv(d?.csv??''));
  const todays = new Set(cand.filter(c=>c.date===today).map(c=>c.name));
  const workingIds = new Set(staff.filter(s=>todays.has(s.name)).map(s=>s.id));
  console.log('workingIds:', workingIds.size, '명');

  // month actions
  const ms=`${today.slice(0,7)}-01T00:00:00+09:00`;
  const { data: acts } = await sb.from('assignment_actions').select('*').eq('clinic_id',FOOT).gte('created_at',ms);

  // today active check-ins
  const { data: cis } = await sb.from('check_ins')
    .select('id, customer_id, customer_name, status, consultant_id, therapist_id, visit_type, treatment_kind, treatment_category, status_flag')
    .eq('clinic_id',FOOT).gte('checked_in_at',`${today}T00:00:00+09:00`)
    .not('status','in','(done,cancelled)');

  const ROLE={consult:'consultant',therapy:'therapist'};
  for (const ci of (cis??[])) {
    const role = ci.status==='consult_waiting'?'consult':ci.status==='treatment_waiting'?'therapy':null;
    if(!role) continue;
    const col = role==='consult'?'consultant_id':'therapist_id';
    if (ci[col]) { console.log(`- ${ci.customer_name}: 이미 배정(skip)`); continue; }
    // customer
    let cust=null;
    if (ci.customer_id){const{data:cu}=await sb.from('customers').select('visit_type, lead_source, visit_route, designated_therapist_id, assigned_consultant_id').eq('id',ci.customer_id).maybeSingle();cust=cu;}
    const axis = role==='consult'?consultAxis(cust??{}):therapyAxis(ci);
    const pool = staff.filter(s=>s.role===ROLE[role]&&workingIds.has(s.id)).map(s=>s.id);
    const desig = role==='consult'?(cust?.assigned_consultant_id??null):(cust?.designated_therapist_id??null);
    let chosen=null;
    if (desig && workingIds.has(desig)) chosen=desig;
    else {
      // least-loaded
      const monthly=new Map(),todayNet=new Map();
      const inc=(m,k,d=1)=>{if(k)m.set(k,(m.get(k)??0)+d);};
      for(const a of (acts??[])){if(a.role!==role)continue;if(a.axis==='returning')continue;if(a.axis===axis){if(a.action_type==='toss'){inc(monthly,a.to_staff_id);inc(monthly,a.from_staff_id,-1);}else inc(monthly,a.to_staff_id);}}
      const scored=pool.map(id=>({id,m:monthly.get(id)??0,t:todayNet.get(id)??0,r:Math.random()})).sort((a,b)=>a.m-b.m||a.t-b.t||a.r-b.r);
      chosen=scored[0]?.id??null;
    }
    const cn = chosen?staff.find(s=>s.id===chosen)?.name:null;
    console.log(`- ${ci.customer_name} [${role}/${axis}] pool=${pool.length} → chosen=${cn??'∅ (미배정 유지)'}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
