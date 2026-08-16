/**
 * T-20260816-foot-JONGNO-OPHOURS-WRITEGATE — Phase 1 READ-ONLY census (prod)
 *
 * 목적(산출1): jongno-foot 신규예약 생성 경로를 (a)외부/도파민 vs (b)스태프 직접입력으로
 *   분류하고, 신 운영창(clinic_operating_hours)을 최근 예약에 소급 적용해
 *   created_via 버킷별 out-of-window 빈도(특히 스태프 manual 예외운영)를 실측한다.
 *
 * PHI 위생: customer_name/phone 등 실명·연락처 컬럼 SELECT 조차 하지 않음.
 *   emit = created_via / date / time / dow / visit_type / status 뿐.
 * UPDATE·INSERT·DDL 절대 없음 — 순수 SELECT census. write0·db_change0.
 * 실행: node scripts/T-20260816-...WRITEGATE_phase1_census_readonly.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// .env.local 로드 (신 형식 sb_secret_ 키; 레거시 JWT service 키는 비활성화됨)
function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const URL = env.VITE_SUPABASE_URL || process.env.SUPABASE_CRM_FOOT_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('❌ env 부재 (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }
const projectRef = URL.replace(/^https:\/\//, '').split('.')[0];
if (projectRef !== 'rxlomoozakkjesdqjtvd') { console.error(`❌ prod ref 불일치: ${projectRef}`); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// 차단축(외부/도파민) created_via 집합 (createdVia.ts SSOT 기준)
const EXTERNAL_VIA = new Set(['dopamine', 'aicc', 'naver', 'meta', 'kakao', 'inbound', 'selfbook']);
// 스태프 직접입력
const STAFF_VIA = new Set(['manual', 'walkin']);

function hhmmToMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

async function main() {
  // 1) jongno clinic_id
  const { data: clinics, error: ce } = await sb.from('clinics').select('id, slug, name');
  if (ce) throw ce;
  const jongno = clinics.find(c => (c.slug || '').includes('jongno') || (c.name || '').includes('종로'));
  console.log('=== clinics ===');
  clinics.forEach(c => console.log(`  ${c.id}  slug=${c.slug}  name=${c.name}`));
  if (!jongno) { console.error('❌ jongno clinic 미발견'); process.exit(1); }
  console.log(`\n>>> jongno clinic_id = ${jongno.id} (slug=${jongno.slug})`);

  // 2) clinic_operating_hours (신 운영창 정본, effective_from 2026-09-01)
  const { data: oh, error: ohe } = await sb.from('clinic_operating_hours')
    .select('day_of_week, open_time, close_time, last_booking_slot, effective_from')
    .eq('clinic_id', jongno.id);
  if (ohe) { console.error('⚠ clinic_operating_hours 조회 실패:', ohe.message); }
  console.log('\n=== clinic_operating_hours (jongno) === (dow 미존재 = 휴무, last_booking_slot INCLUSIVE)');
  const windowByDow = {}; // dow -> {openMin, lastMin} ; 미존재 dow = 휴무
  (oh || []).forEach(r => {
    console.log(`  dow=${r.day_of_week} open=${r.open_time} close=${r.close_time} last_slot=${r.last_booking_slot} eff=${r.effective_from}`);
    windowByDow[r.day_of_week] = {
      openMin: hhmmToMin(r.open_time),
      lastMin: hhmmToMin(r.last_booking_slot),
    };
  });

  // 3) reservations census — 최근 120일 (PHI 컬럼 미조회)
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('reservations')
      .select('reservation_date, reservation_time, created_via, source_system, visit_type, status')
      .eq('clinic_id', jongno.id)
      .gte('reservation_date', since)
      .order('reservation_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`\n=== reservations census (jongno, since ${since}, n=${rows.length}) ===`);

  // out-of-window 판정: 해당 dow closed OR time < open OR time > last_booking_slot
  function isOutOfWindow(r) {
    if (!r.reservation_date || !r.reservation_time) return null; // 판정불가
    const dow = new Date(r.reservation_date + 'T00:00:00').getDay(); // 0=Sun..6=Sat (day_of_week 정합)
    const w = windowByDow[dow];
    if (!w) return true; // 해당 dow 운영창 행 미존재 = 휴무 = out-of-window (예: 일요일)
    const t = hhmmToMin(r.reservation_time);
    if (t == null || w.openMin == null || w.lastMin == null) return null;
    return t < w.openMin || t > w.lastMin; // last_booking_slot INCLUSIVE → 초과분만 out
  }

  function bucketOf(via) {
    const v = (via || '').toLowerCase();
    if (EXTERNAL_VIA.has(v)) return 'external';
    if (STAFF_VIA.has(v)) return 'staff';
    return `other(${via ?? 'NULL'})`;
  }

  const agg = {}; // bucket -> {total, out, undetermined, byVia:{}, outByVia:{}}
  for (const r of rows) {
    const b = bucketOf(r.created_via);
    agg[b] ||= { total: 0, out: 0, undetermined: 0, byVia: {}, outByVia: {} };
    agg[b].total++;
    const via = r.created_via ?? 'NULL';
    agg[b].byVia[via] = (agg[b].byVia[via] || 0) + 1;
    const oow = isOutOfWindow(r);
    if (oow === null) agg[b].undetermined++;
    else if (oow) { agg[b].out++; agg[b].outByVia[via] = (agg[b].outByVia[via] || 0) + 1; }
  }

  console.log('\n=== 버킷별 집계 (신 운영창 소급 적용) ===');
  const days = 120;
  for (const [b, a] of Object.entries(agg)) {
    const perMonth = (a.out / days * 30).toFixed(1);
    console.log(`\n[${b}] total=${a.total}  out-of-window=${a.out} (판정불가=${a.undetermined})  ≈${perMonth}건/월`);
    console.log(`   created_via 분포: ${JSON.stringify(a.byVia)}`);
    console.log(`   out-of-window created_via 분포: ${JSON.stringify(a.outByVia)}`);
  }

  // 스태프 out-of-window 시간대 분포 (예외운영 유형 실태)
  console.log('\n=== 스태프(manual/walkin) out-of-window 시간대 분포 ===');
  const staffOutByHour = {};
  const staffOutByVisitType = {};
  for (const r of rows) {
    if (bucketOf(r.created_via) !== 'staff') continue;
    if (isOutOfWindow(r) !== true) continue;
    const hr = String(r.reservation_time || '').slice(0, 2);
    staffOutByHour[hr] = (staffOutByHour[hr] || 0) + 1;
    const vt = r.visit_type ?? 'NULL';
    staffOutByVisitType[vt] = (staffOutByVisitType[vt] || 0) + 1;
  }
  console.log(`   시간대(HH): ${JSON.stringify(staffOutByHour)}`);
  console.log(`   visit_type: ${JSON.stringify(staffOutByVisitType)}`);
  console.log('\n✅ census done (READ-ONLY, write0).');
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
