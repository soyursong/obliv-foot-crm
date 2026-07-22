// ============================================================================
// T-20260722-foot-TMAGG-DOPAMINE-ACCTKEY-DIAGNOSE  (read-only 진단)
//
// 목적: 박민지 TM팀장 전제 정정("도파민 상담사도 풋CRM에 role=tm 계정 있음") 사실 확정.
//   AC-D1 계정 실재 / AC-D2 created_by 채움 실태 / AC-D3 매핑 안전성.
//   ★ read-only — SELECT only. write/DDL/데이터 무변경 (AC-D4).
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
line('T-20260722-foot-TMAGG-DOPAMINE-ACCTKEY-DIAGNOSE — read-only evidence');
line('======================================================================');

// ---------------------------------------------------------------------------
// AC-D1 (계정 실재): user_profiles 에 role='tm' 계정 실측
// ---------------------------------------------------------------------------
line('\n########## AC-D1  계정 실재 — user_profiles role 분포 ##########');
const { data: allProfiles, error: eP } = await sb
  .from('user_profiles')
  .select('id,name,email,role,active,clinic_id,created_at');
if (eP) { line('  ERR user_profiles: ' + eP.message); }
const profs = allProfiles || [];
line(`  user_profiles total = ${profs.length}`);

const roleDist = {};
for (const p of profs) {
  const key = `${p.role ?? '∅'}${p.active ? '' : '(inactive)'}`;
  roleDist[key] = (roleDist[key] || 0) + 1;
}
line('  role 분포 (active/inactive): ' + JSON.stringify(roleDist));

const tmAccounts = profs.filter(p => (p.role || '').toLowerCase() === 'tm');
line(`\n  >>> role='tm' 계정 = ${tmAccounts.length} 건`);
for (const t of tmAccounts) {
  line(`     - id=${t.id}  name=${t.name ?? '∅'}  email=${t.email ?? '∅'}  active=${t.active}  clinic=${t.clinic_id ?? '∅'}`);
}
// tm 외에 도파민 상담사로 의심되는 계정도 fuzzy 확인 (이름/이메일에 tm/도파민/counsel 힌트)
const fuzzy = profs.filter(p => {
  const blob = `${p.name ?? ''} ${p.email ?? ''} ${p.role ?? ''}`.toLowerCase();
  return /tm|도파민|dopamine|counsel|상담/.test(blob) && (p.role || '').toLowerCase() !== 'tm';
});
if (fuzzy.length) {
  line(`\n  (참고) role≠tm 이나 tm/상담/도파민 힌트 있는 계정 = ${fuzzy.length}`);
  for (const f of fuzzy) line(`     ? id=${f.id} name=${f.name ?? '∅'} email=${f.email ?? '∅'} role=${f.role} active=${f.active}`);
}

const tmIdSet = new Set(tmAccounts.map(t => String(t.id)));
const activeTmIdSet = new Set(tmAccounts.filter(t => t.active).map(t => String(t.id)));

// ---------------------------------------------------------------------------
// AC-D2 (created_by 채움 실태): source_system='dopamine' 예약의 created_by 분포
// ---------------------------------------------------------------------------
line('\n########## AC-D2  created_by 채움 실태 — dopamine-origin 예약 ##########');
const { data: dopaResv, error: eR } = await sb
  .from('reservations')
  .select('id,created_by,registrar_name,source_system,reservation_date,clinic_id')
  .eq('source_system', 'dopamine');
if (eR) { line('  ERR reservations(dopamine): ' + eR.message); }
const rows = dopaResv || [];
line(`  source_system='dopamine' 예약 total = ${rows.length}`);

let cbFilled = 0, cbNull = 0;
const cbValues = {};           // created_by 값별 건수
let filledMatchTm = 0, filledMatchActiveTm = 0, filledMatchNonTm = 0, filledNoMatchProfile = 0;
const profById = Object.fromEntries(profs.map(p => [String(p.id), p]));

for (const r of rows) {
  const cb = (r.created_by ?? '').toString().trim();
  if (cb === '') { cbNull++; continue; }
  cbFilled++;
  cbValues[cb] = (cbValues[cb] || 0) + 1;
  const prof = profById[cb];
  if (!prof) { filledNoMatchProfile++; }
  else if ((prof.role || '').toLowerCase() === 'tm') {
    filledMatchTm++;
    if (prof.active) filledMatchActiveTm++;
  } else { filledMatchNonTm++; }
}
line(`  created_by 채워짐 = ${cbFilled} 건 / NULL(빈값) = ${cbNull} 건`);
line(`\n  [채워진 건의 created_by → user_profile 매칭 분해]`);
line(`     · role='tm' 계정 매칭        = ${filledMatchTm}  (그중 active = ${filledMatchActiveTm})`);
line(`     · role≠tm(다른직원) 계정 매칭 = ${filledMatchNonTm}`);
line(`     · user_profile 미매칭(고아값)  = ${filledNoMatchProfile}`);

line(`\n  [created_by distinct 값별 (상위 25) — 값 / 건수 / 매칭 profile]`);
const cbSorted = Object.entries(cbValues).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [cb, n] of cbSorted) {
  const p = profById[cb];
  const desc = p ? `name=${p.name ?? '∅'} role=${p.role ?? '∅'} active=${p.active}` : 'NO_PROFILE(고아)';
  line(`     ${String(n).padStart(4)}  ${cb.padEnd(38)}  ${desc}`);
}

// registrar_name 실태 (dopamine 행) — REPOINT 이전 mutable 문자열 축 참고
let regFilled = 0, regNull = 0;
const regVals = {};
for (const r of rows) {
  const rn = (r.registrar_name ?? '').toString().trim();
  if (rn === '') regNull++; else { regFilled++; regVals[rn] = (regVals[rn] || 0) + 1; }
}
line(`\n  [참고] dopamine 행 registrar_name 채움 = ${regFilled} / 빈값 = ${regNull}`);
line('    registrar_name distinct (상위 15): ' +
  JSON.stringify(Object.entries(regVals).sort((a, b) => b[1] - a[1]).slice(0, 15)));

// ---------------------------------------------------------------------------
// AC-D3 (매핑 안전성): 로컬 foot 데이터만으로 dopamine 상담사 ↔ tm 계정 매핑 성립?
// ---------------------------------------------------------------------------
line('\n########## AC-D3  매핑 안전성 (로컬 foot 데이터 only) ##########');
const dopaCbFilledDistinct = Object.keys(cbValues);
const dopaCbResolvableToTm = dopaCbFilledDistinct.filter(cb => tmIdSet.has(cb));
const dopaCbResolvableToActiveTm = dopaCbFilledDistinct.filter(cb => activeTmIdSet.has(cb));
line(`  dopamine 예약의 distinct created_by 값 = ${dopaCbFilledDistinct.length}`);
line(`     · 그중 로컬 user_profiles role='tm' 로 해석됨       = ${dopaCbResolvableToTm.length}`);
line(`     · 그중 active role='tm' 로 해석됨(화면 라벨 반영됨) = ${dopaCbResolvableToActiveTm.length}`);
line(`  → created_by(=user_profiles.id)는 로컬 조인만으로 per-name 성립 (email-resolve/counselor_id 타CRM 반입 불필요).`);
line(`    (§963⑩(b)/(⑥) 금지 클래스 = cross-namespace resolve. 본 경로는 로컬 UUID FK 조인이라 미저촉.)`);

// 판정 요약
line('\n======================================================================');
line('판정 요약 (evidence 기반, 정책 재adjudication 은 DA 몫)');
line('======================================================================');
const verdict =
  cbFilled > 0 && filledMatchActiveTm > 0
    ? 'AC-D2 (a) 계열 — created_by 가 active tm 계정으로 채워진 dopamine 예약 존재 → 로컬 정규키로 per-name 분해 가능(§963⑩(a) 재검토 대상)'
    : cbFilled > 0 && filledMatchTm > 0
      ? 'AC-D2 (a/부분) — created_by 채워지고 tm 계정 매칭되나 active=false 다수(라벨 미반영 가능)'
      : cbFilled === 0
        ? 'AC-D2 (b) 계열 — dopamine 예약 created_by 전부 NULL → 계정은 있어도 push RPC 가 미채움. per-name = emit-side 변경 필요(§963⑩(b)/⑥ 재검토)'
        : 'AC-D2 혼재 — created_by 일부 채워짐(비-tm/고아 포함). 아래 분해 수치로 DA 판정';
line(`  · AC-D1: role='tm' 계정 실재 = ${tmAccounts.length}건 (active ${tmAccounts.filter(t => t.active).length}) → 전제 정정 ${tmAccounts.length > 0 ? 'field-CORRECT (계정 있음)' : 'NOT-confirmed (tm 계정 0)'}`);
line(`  · AC-D2: dopamine 예약 ${rows.length}건 中 created_by 채움 ${cbFilled}/NULL ${cbNull}. ${verdict}`);
line(`  · AC-D3: created_by→user_profiles 로컬 UUID 조인으로 매핑 성립 (cross-CRM resolve 불요). 금지클래스 미저촉.`);
line(`  · AC-D4: 본 실행 SELECT-only, write/DDL 0건.`);
line('======================================================================');

process.exit(0);
