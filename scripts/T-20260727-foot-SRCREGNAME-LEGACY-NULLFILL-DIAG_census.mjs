// ============================================================================
// T-20260727-foot-SRCREGNAME-LEGACY-NULLFILL-DIAG-BACKFILL  (census, read-only)
//
// 목적(DIAGNOSE-FIRST, RO): dopamine RETRIAGE fold 부상 — 3 TM상담사(김효신/진운선/
//   이수빈) 도파민-origin 풋 착지 예약 ≈521건 중 registrar 표시축 NULL 코호트 규모·원인
//   census + body RC(nested source_registrant top-level-only 파싱) 동형 대조 +
//   prefix-strip lane(강솔희 '[도파민TM]') 교집합/disjoint 확인.
//
//   ★ read-only — SELECT only. write/DDL/백필 0건 (실 UPDATE 는 census 후 planner
//     FOLLOWUP → DA CONSULT(ADDITIVE) + Backfill SOP + 사람 확인 게이트 통과 후).
//   §416 created_by write 금지 / §963⑥ display-provenance(표시 컬럼) only.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const line = (s = '') => console.log(s);

line('======================================================================');
line('T-20260727-foot-SRCREGNAME-LEGACY-NULLFILL census — read-only evidence');
line('======================================================================');

// ---------------------------------------------------------------------------
// [0] 컬럼 실재 확인: foot 의 registrar 표시축 컬럼명 = registrar_name?
//     티켓은 cross-CRM 명 'source_registrant_name' 사용 — foot 에 실재하는지 판정.
// ---------------------------------------------------------------------------
line('\n########## [0] 컬럼 실재 (foot reservations registrar 표시축) ##########');
for (const col of ['registrar_name', 'registrar_id', 'source_registrant_name', 'source_registrant']) {
  const { error } = await sb.from('reservations').select(col).limit(1);
  line(`  ${col.padEnd(24)} : ${error ? 'ABSENT (' + (error.message || '').slice(0, 60) + ')' : 'PRESENT'}`);
}

// ---------------------------------------------------------------------------
// [1] dopamine-origin 풋 예약 registrar_name 상태 분해
// ---------------------------------------------------------------------------
line('\n########## [1] dopamine-origin 예약 registrar_name 상태 ##########');
// clinics slug 조회 (jongno-foot id)
const { data: clinics } = await sb.from('clinics').select('id,slug');
const slugById = Object.fromEntries((clinics || []).map(c => [String(c.id), c.slug]));

const { data: rows, error: eR } = await sb
  .from('reservations')
  .select('id,external_id,registrar_name,registrar_id,source_system,created_via,reservation_date,clinic_id,visit_route')
  .eq('source_system', 'dopamine');
if (eR) { line('  ERR: ' + eR.message); process.exit(1); }
const R = rows || [];
line(`  source_system='dopamine' 예약 total = ${R.length}`);

let regNull = 0, regPrefix = 0, regResolved = 0;
let regNullDates = [], regPrefixVals = {};
const clinicDist = {};
for (const r of R) {
  const slug = slugById[String(r.clinic_id)] || r.clinic_id || '∅';
  clinicDist[slug] = (clinicDist[slug] || 0) + 1;
  const rn = (r.registrar_name ?? '').toString().trim();
  if (rn === '') { regNull++; if (r.reservation_date) regNullDates.push(r.reservation_date); }
  else if (rn.startsWith('[도파민TM]')) { regPrefix++; regPrefixVals[rn] = (regPrefixVals[rn] || 0) + 1; }
  else { regResolved++; }
}
line(`  clinic 분포: ${JSON.stringify(clinicDist)}`);
line(`\n  [registrar_name 3분기 상태]`);
line(`     · NULL/빈값                = ${regNull}   ← NULL-fill lane 후보(본 티켓)`);
line(`     · '[도파민TM] X' prefix라벨 = ${regPrefix}   ← prefix-strip lane(강솔희 별건) 대상`);
line(`     · 해소된 마스터명(정상표시) = ${regResolved}`);
if (regNullDates.length) {
  regNullDates.sort();
  line(`\n  [NULL 코호트 예약일 범위] min=${regNullDates[0]}  max=${regNullDates[regNullDates.length - 1]}  (n=${regNullDates.length})`);
  // 월별 분포
  const byMonth = {};
  for (const d of regNullDates) { const m = String(d).slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; }
  line(`  [NULL 코호트 월별] ${JSON.stringify(byMonth)}`);
}
line(`\n  [prefix-strip lane 라벨 distinct (상위 15) — double-touch 방지 확인용]`);
line('     ' + JSON.stringify(Object.entries(regPrefixVals).sort((a, b) => b[1] - a[1]).slice(0, 15)));

// ---------------------------------------------------------------------------
// [2] NULL 코호트 vs prefix 코호트 disjoint 검증 (SQL 술어 상호배타)
// ---------------------------------------------------------------------------
line('\n########## [2] lane 교집합/disjoint 검증 ##########');
line(`  본 lane(NULL-fill)  술어: registrar_name IS NULL (또는 btrim='')  → ${regNull}건`);
line(`  별 lane(prefix-strip) 술어: registrar_name LIKE '[도파민TM]%'      → ${regPrefix}건`);
line(`  → 두 술어는 상호배타(한 행은 NULL 이거나 non-NULL 라벨) = DISJOINT.`);
line(`     동일 행이 양 lane 에 동시 진입 불가 → double-touch 구조적 불가.`);

// ---------------------------------------------------------------------------
// [3] registrar_id 동반 상태 (표시축 완전 NULL 인지)
// ---------------------------------------------------------------------------
line('\n########## [3] NULL 코호트의 registrar_id 동반 상태 ##########');
let nullNameNullId = 0, nullNameHasId = 0;
for (const r of R) {
  const rn = (r.registrar_name ?? '').toString().trim();
  if (rn !== '') continue;
  if (r.registrar_id) nullNameHasId++; else nullNameNullId++;
}
line(`  registrar_name NULL 중: registrar_id 도 NULL = ${nullNameNullId} / registrar_id 有 = ${nullNameHasId}`);
line(`  (id 有인데 name NULL 이면 스냅샷 누락형 — FK로 name 재해소 가능. 둘 다 NULL 이면 순수 미착지.)`);

// ---------------------------------------------------------------------------
// [4] created_via / visit_route 부가 프로파일
// ---------------------------------------------------------------------------
line('\n########## [4] NULL 코호트 created_via / visit_route 프로파일 ##########');
const cvDist = {}, vrDist = {};
for (const r of R) {
  const rn = (r.registrar_name ?? '').toString().trim();
  if (rn !== '') continue;
  const cv = r.created_via ?? '∅'; cvDist[cv] = (cvDist[cv] || 0) + 1;
  const vr = r.visit_route ?? '∅'; vrDist[vr] = (vrDist[vr] || 0) + 1;
}
line(`  created_via: ${JSON.stringify(cvDist)}`);
line(`  visit_route: ${JSON.stringify(vrDist)}`);

line('\n======================================================================');
line('census 요약');
line(`  · dopamine 예약 ${R.length}건 中 registrar_name NULL=${regNull} / prefix=${regPrefix} / resolved=${regResolved}`);
line(`  · NULL-fill lane 후보 = ${regNull}건 (3상담사 ≈521 는 dopamine cross-ref 규모; foot 은 counselor 링크 부재로 술어=registrar_name NULL)`);
line(`  · prefix-strip lane 과 DISJOINT (술어 상호배타) → double-touch 불가`);
line(`  · 실 UPDATE 미실행 (SELECT-only). 게이트: planner FOLLOWUP → DA CONSULT(ADDITIVE) + Backfill SOP + 사람 확인.`);
line('======================================================================');
process.exit(0);
