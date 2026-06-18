/**
 * T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL — repro (REAL parser)
 *
 * diag.mjs 의 pool 근사(`csv.includes(name)`)는 신뢰 불가 → 실제 dutySheet.ts 파서
 * (날짜-칼럼 기준 parseDutyAttendees)를 verbatim 이식해 "오늘 진짜 출근 풀"을 재현하고,
 * maybeAutoAssign 이 슬롯 진입 시점에 산출하는 pool 이 실제로 비는지 검증한다.
 *
 * READ-ONLY. 변경 없음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const FOOT_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DUTY_GIDS = ['341864863'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function todaySeoulISODate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ── dutySheet.ts 파서 verbatim 이식 (pure) ──────────────────────────────────
const REST_TOKENS = new Set(['휴진', '휴무', '오프', 'off', 'OFF', '-', '·', '–', '—']);
const ALL_STAFF_TOKEN = '전직원';
const SUPERVISOR_TOKEN = '총괄';
const SUPERVISOR_NAME = '김주연';
const pad2 = (n) => String(n).padStart(2, '0');
function parseCsvLine(line) { const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else if(ch==='"')q=true;else if(ch===','){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function parseCsv(csv){return csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').map(parseCsvLine);}
function dayNumberOf(cell){const s=(cell??'').toString().trim();if(!/^\d{1,2}$/.test(s))return null;const n=parseInt(s,10);return n>=1&&n<=31?n:null;}
function dayColumnsOf(row){const out=[];row.forEach((cell,ci)=>{const d=dayNumberOf(cell);if(d!=null)out.push({col:ci,day:d});});return out;}
function parseMonthHeader(row){let month,year,team;for(const cr of row){const cell=(cr??'').toString().trim();if(!cell)continue;const mm=cell.match(/^(\d{1,2})\s*월$/);if(mm){month=parseInt(mm[1],10);continue;}const ym=cell.match(/^(20\d{2})$/);if(ym){year=parseInt(ym[1],10);continue;}if(!/^[월화수목금토일]$/.test(cell)&&!/^\d+$/.test(cell)){if(!team||cell.length>team.length)team=cell;}}if(month==null)return null;return{year,month,team};}
function resolveRowDates(dayCols,sy,sm){let y=sy,m=sm,prev=0;const colDate=new Map();for(const{col,day}of dayCols){if(prev&&day<prev){m+=1;if(m>12){m=1;y+=1;}}colDate.set(col,`${y}-${pad2(m)}-${pad2(day)}`);prev=day;}return{colDate,endYear:y,endMonth:m};}
function extractCandidates(grid){const now=new Date();let cy=now.getFullYear(),cm=now.getMonth()+1,team='';const cands=[];let i=0;while(i<grid.length){const row=grid[i]??[];const hdr=parseMonthHeader(row);if(hdr){if(hdr.year!=null)cy=hdr.year;if(hdr.month!=null)cm=hdr.month;if(hdr.team)team=hdr.team;i+=1;continue;}const dc=dayColumnsOf(row);if(dc.length>=3){const{colDate,endYear,endMonth}=resolveRowDates(dc,cy,cm);let j=i+1;for(;j<grid.length;j++){const ar=grid[j]??[];if(parseMonthHeader(ar))break;if(dayColumnsOf(ar).length>=3)break;for(const[col,date]of colDate){const raw=(ar[col]??'').toString().trim();if(!raw)continue;if(REST_TOKENS.has(raw))continue;cands.push({name:raw,date,team});}}cy=endYear;cm=endMonth;i=j;continue;}i+=1;}return cands;}
function parseDutyAttendees(csv,todayIso,allStaffNames=[]){const grid=parseCsv(csv);const cands=extractCandidates(grid);const out=[];const push=(n)=>{const t=(n??'').trim();if(t&&!out.includes(t))out.push(t);};for(const c of cands){if(c.date!==todayIso)continue;if(c.name===ALL_STAFF_TOKEN){for(const s of allStaffNames)push(s);}else if(c.name===SUPERVISOR_TOKEN)push(SUPERVISOR_NAME);else push(c.name);}return out;}

async function main() {
  const today = todaySeoulISODate();
  console.log('=== AUTOASSIGN repro (REAL parser) today KST =', today, '===\n');

  const { data: staffRows } = await supabase.from('staff').select('id, name, role, active').eq('clinic_id', FOOT_CLINIC).eq('active', true);
  const allNames = staffRows.map((s) => s.name);
  const consultants = staffRows.filter((s) => s.role === 'consultant');
  const therapists = staffRows.filter((s) => s.role === 'therapist');

  // 실제 파서로 오늘 출근자
  let attendees = [];
  for (const gid of DUTY_GIDS) {
    const { data, error } = await supabase.functions.invoke('duty-sheet-read', { body: { gid } });
    if (error) { console.log(`gid=${gid} EF error:`, error.message); continue; }
    const csv = data?.csv ?? '';
    const names = parseDutyAttendees(csv, today, allNames);
    console.log(`[gid=${gid}] parseDutyAttendees(오늘) → ${names.length}명:`, names.join(', ') || '(없음)');
    attendees = [...new Set([...attendees, ...names])];
  }

  const workingConsult = consultants.filter((s) => attendees.includes(s.name));
  const workingTherapy = therapists.filter((s) => attendees.includes(s.name));
  console.log(`\n[REAL pool] 상담 출근 ${workingConsult.length}명:`, workingConsult.map((s)=>s.name).join(', ') || '(공집합)');
  console.log(`[REAL pool] 치료 출근 ${workingTherapy.length}명:`, workingTherapy.map((s)=>s.name).join(', ') || '(공집합)');

  // 오늘 미배정 체크인 + 그 슬롯에서의 pool 판정
  const { data: ci } = await supabase.from('check_ins')
    .select('id, customer_name, status, consultant_id, therapist_id, visit_type, checked_in_at, created_at')
    .eq('clinic_id', FOOT_CLINIC).gte('checked_in_at', `${today}T00:00:00+09:00`)
    .not('status', 'in', '(done,cancelled)').order('checked_in_at', { ascending: true });
  console.log(`\n[오늘 체크인 ${ci?.length ?? 0}건]`);
  for (const c of (ci ?? [])) {
    console.log(`  - ${c.customer_name} | status=${c.status} visit=${c.visit_type} | consultant=${c.consultant_id?'O':'·'} therapist=${c.therapist_id?'O':'·'} | checked_in=${c.checked_in_at}`);
  }

  // 오늘 status_transitions 로 → consult_waiting/treatment_waiting 진입 이력
  const ciIds = (ci ?? []).map((c) => c.id);
  if (ciIds.length) {
    const { data: tr } = await supabase.from('status_transitions')
      .select('check_in_id, from_status, to_status, transitioned_at')
      .in('check_in_id', ciIds).in('to_status', ['consult_waiting','treatment_waiting'])
      .order('transitioned_at', { ascending: true });
    console.log(`\n[오늘 대기-슬롯 진입 transition ${tr?.length ?? 0}건] (= maybeAutoAssign 트리거 지점)`);
    for (const t of (tr ?? [])) console.log(`  - ci=${t.check_in_id.slice(0,8)} ${t.from_status}→${t.to_status} @ ${t.transitioned_at}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
