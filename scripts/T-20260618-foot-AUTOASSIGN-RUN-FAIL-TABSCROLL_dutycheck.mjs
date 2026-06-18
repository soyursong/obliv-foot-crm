/**
 * 오늘(KST) duty 시트 실제 출근자 정밀 추출 — 클라 parseDutyAttendees 로직 이식.
 * workingIds 공집합 여부를 today 칼럼 기준으로 정확히 검증. READ-ONLY.
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const REST = new Set(['휴진','휴무','오프','off','OFF','-','·','–','—']);
const pad2 = (n) => String(n).padStart(2,'0');
function parseCsvLine(line){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else if(c==='"')q=true;else if(c===','){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
function parseCsv(s){return s.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').map(parseCsvLine);}
function dayNum(c){const s=(c??'').toString().trim();if(!/^\d{1,2}$/.test(s))return null;const n=+s;return n>=1&&n<=31?n:null;}
function dayCols(r){const o=[];r.forEach((c,i)=>{const d=dayNum(c);if(d!=null)o.push({col:i,day:d});});return o;}
function monthHdr(r){let mo,yr,team;for(const cr of r){const c=(cr??'').toString().trim();if(!c)continue;const mm=c.match(/^(\d{1,2})\s*월$/);if(mm){mo=+mm[1];continue;}const ym=c.match(/^(20\d{2})$/);if(ym){yr=+ym[1];continue;}if(!/^[월화수목금토일]$/.test(c)&&!/^\d+$/.test(c)){if(!team||c.length>team.length)team=c;}}if(mo==null)return null;return{year:yr,month:mo,team};}
function resolveDates(dc,sy,sm){let y=sy,m=sm,prev=0;const md=new Map();for(const{col,day}of dc){if(prev&&day<prev){m++;if(m>12){m=1;y++;}}md.set(col,`${y}-${pad2(m)}-${pad2(day)}`);prev=day;}return{md,ey:y,em:m};}
function extract(grid){const now=new Date();let cy=now.getFullYear(),cm=now.getMonth()+1,team='';const cand=[];let i=0;while(i<grid.length){const row=grid[i]??[];const h=monthHdr(row);if(h){if(h.year!=null)cy=h.year;if(h.month!=null)cm=h.month;if(h.team)team=h.team;i++;continue;}const dc=dayCols(row);if(dc.length>=3){const{md,ey,em}=resolveDates(dc,cy,cm);let j=i+1;for(;j<grid.length;j++){const ar=grid[j]??[];if(monthHdr(ar))break;if(dayCols(ar).length>=3)break;for(const[col,date]of md){const raw=(ar[col]??'').toString().trim();if(!raw)continue;if(REST.has(raw))continue;cand.push({name:raw,date,team});}}cy=ey;cm=em;i=j;continue;}i++;}return cand;}

function todayKST(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

async function main(){
  const today=todayKST();
  console.log('today KST =',today);
  const { data } = await supabase.functions.invoke('duty-sheet-read',{body:{gid:'341864863'}});
  const csv = data?.csv ?? '';
  const grid = parseCsv(csv);
  const cand = extract(grid);
  const todays = [...new Set(cand.filter(c=>c.date===today).map(c=>c.name))];
  console.log('\n오늘 시트 출근자(정밀 파서):', todays.join(', ') || '(없음)');

  const { data: staffRows } = await supabase.from('staff').select('name, role').eq('clinic_id',FOOT_CLINIC).eq('active',true);
  const matchC = staffRows.filter(s=>s.role==='consultant'&&todays.includes(s.name)).map(s=>s.name);
  const matchT = staffRows.filter(s=>s.role==='therapist'&&todays.includes(s.name)).map(s=>s.name);
  console.log(`\n→ 오늘 상담 후보풀: ${matchC.length}명`, matchC.join(', '));
  console.log(`→ 오늘 치료 후보풀: ${matchT.length}명`, matchT.join(', '));

  // 시트엔 있으나 staff 매칭 안 되는 이름(이름 불일치 진단)
  const staffNames = new Set(staffRows.map(s=>s.name));
  const unmatched = todays.filter(n=>!staffNames.has(n));
  console.log('\n시트 출근자 중 staff 미매칭:', unmatched.join(', ') || '(없음)');

  // 전체 날짜 분포 (시트에 오늘 날짜 자체가 존재하는지)
  const dates = [...new Set(cand.map(c=>c.date))].sort();
  console.log('\n시트 커버 날짜 범위:', dates[0], '~', dates[dates.length-1], `(${dates.length}일)`);
  console.log('오늘 포함 여부:', dates.includes(today));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
