// ============================================================================
// T-20260727-foot-SRCREGNAME-TMPREFIX-STRIP-BACKFILL  (AC0 DIAGNOSE-FIRST)
//
// 목적: 강솔희 상담사 등록자 이름 '도파민 TM : ' prefix 오염의 foot 미러 진단.
//   ★ read-only — SELECT only. NO write / NO DDL / 데이터 무변경.
//
// AC0-1 저장위치 확정: (a) reservations.registrar_name(§963⑥ display carriage)
//                     vs (b) staff.name / reservation_registrars.name(마스터=별 클래스).
//   → (b)면 STOP → planner FOLLOWUP.
// AC0-2 오염 코호트 census: source_system='dopamine' AND registrar_name LIKE prefix변형.
//   전각/반각 콜론(: ：)·공백 변형 포함. 강솔희 외 타 상담사 행도 잡히나.
// AC0-3 forward-durability: foot ingest EF가 emit registrar_name 을 concat 없이 착지하나
//   (코드 정합) + 마스터에 prefix 오염 잔존 여부.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const line = (s = '') => console.log(s);

// prefix 지문: /^\s*도파민\s*TM\s*[:：]\s*/i  (전각/반각 콜론·공백 변형)
const PREFIX_RE = /^\s*도파민\s*TM\s*[:：]\s*/i;
const strip = (s) => (s == null ? s : s.replace(PREFIX_RE, ''));

line('======================================================================');
line('T-20260727-foot-SRCREGNAME-TMPREFIX-STRIP-BACKFILL — AC0 read-only diag');
line('DB=' + env.VITE_SUPABASE_URL);
line('======================================================================');

// ---------------------------------------------------------------------------
// AC0-1 (a): reservations.registrar_name — 강솔희/prefix 저장 실태
// ---------------------------------------------------------------------------
line('\n########## AC0-1(a)  reservations.registrar_name census ##########');
const { data: resvs, error: eR } = await sb
  .from('reservations')
  .select('id, source_system, external_id, registrar_id, registrar_name, created_by, created_at')
  .not('registrar_name', 'is', null);
if (eR) { line('  ERR reservations: ' + eR.message); }
const rows = resvs || [];
line(`  registrar_name NOT NULL 총 = ${rows.length} 건`);

// prefix 오염 행 (전체, source 무관)
const contamAll = rows.filter(r => PREFIX_RE.test(r.registrar_name || ''));
line(`  ▶ registrar_name 이 prefix('도파민 TM :') 매칭 = ${contamAll.length} 건 (source 무관)`);

// AC0-2: source_system='dopamine' 교집합 (버그경로 지문)
const contamDopa = contamAll.filter(r => (r.source_system || '').toLowerCase() === 'dopamine');
line(`  ▶ ∩ source_system='dopamine' = ${contamDopa.length} 건  ← 백필 대상셋 후보(지문 교집합)`);

// 강솔희 포함 여부 + 잡히는 상담사 실명 분포
const nameDist = {};
let createdByNonNull = 0;
for (const r of contamDopa) {
  const real = strip(r.registrar_name);
  nameDist[real] = (nameDist[real] || 0) + 1;
  if (r.created_by != null) createdByNonNull++;
}
line('\n  대상셋 strip 후 실명 분포 (강솔희 외 타 상담사 포함 여부 확인):');
for (const [nm, c] of Object.entries(nameDist).sort((a,b)=>b[1]-a[1])) {
  const empty = (nm ?? '').trim() === '' ? '  ⚠STRIP후 공란(skip대상)' : '';
  line(`     - "${nm}"  × ${c} 건${empty}`);
}
line(`\n  ★ created_by HARD INVARIANT: 대상셋 중 created_by != NULL = ${createdByNonNull} 건 (기대=0, §416/§963⑤)`);

// 강솔희 명시 검색 (prefix 유무 무관)
const kang = rows.filter(r => (r.registrar_name || '').includes('강솔희'));
line(`\n  "강솔희" 문자열 포함 registrar_name = ${kang.length} 건:`);
for (const r of kang.slice(0, 20)) {
  line(`     id=${r.id} src=${r.source_system ?? '∅'} regId=${r.registrar_id ?? 'NULL'} created_by=${r.created_by ?? 'NULL'} name="${r.registrar_name}"`);
}
if (kang.length > 20) line(`     ... +${kang.length - 20} more`);

// prefix 콜론 변형 실측 (어떤 콜론/공백 형태인지)
line('\n  prefix 실제 형태(distinct):');
const shapeSet = {};
for (const r of contamAll) {
  const mm = (r.registrar_name || '').match(PREFIX_RE);
  const pfx = mm ? mm[0] : '(none)';
  shapeSet[JSON.stringify(pfx)] = (shapeSet[JSON.stringify(pfx)] || 0) + 1;
}
for (const [pfx, c] of Object.entries(shapeSet)) line(`     ${pfx} × ${c}`);

// ---------------------------------------------------------------------------
// AC0-1 (b): staff.name / reservation_registrars.name — prefix 오염이 마스터에 있나?
//   (b)면 STOP → 별 클래스 결함
// ---------------------------------------------------------------------------
line('\n########## AC0-1(b)  마스터 테이블 prefix 오염 검사 (STOP 게이트) ##########');

const { data: staff, error: eS } = await sb.from('staff').select('id, name, role, active').limit(2000);
if (eS) line('  ERR staff: ' + eS.message);
const staffContam = (staff || []).filter(s => PREFIX_RE.test(s.name || ''));
const staffKang = (staff || []).filter(s => (s.name || '').includes('강솔희'));
line(`  staff 총=${(staff||[]).length}  prefix 오염=${staffContam.length}  "강솔희" 포함=${staffKang.length}`);
for (const s of staffKang) line(`     STAFF id=${s.id} role=${s.role ?? '∅'} active=${s.active} name="${s.name}"`);
if (staffContam.length) { line('  ⚠⚠ STOP 후보: staff.name 에 prefix 오염 존재 → 별 클래스 결함(본 SOP 부적용)'); }

const { data: regs, error: eRR } = await sb.from('reservation_registrars').select('id, name, group_name, clinic_id, active').limit(2000);
if (eRR) line('  ERR reservation_registrars: ' + eRR.message);
const regContam = (regs || []).filter(x => PREFIX_RE.test(x.name || ''));
const regKang = (regs || []).filter(x => (x.name || '').includes('강솔희'));
line(`\n  reservation_registrars 총=${(regs||[]).length}  prefix 오염=${regContam.length}  "강솔희" 포함=${regKang.length}`);
for (const x of regKang) line(`     REGISTRAR id=${x.id} group=${x.group_name ?? '∅'} active=${x.active} name="${x.name}"`);
if (regContam.length) {
  line('  ⚠⚠ 마스터(reservation_registrars)에 prefix 오염 존재:');
  for (const x of regContam) line(`       id=${x.id} group=${x.group_name} name="${x.name}"`);
  line('     → 마스터 오염이면 신규 스냅샷도 계속 오염 전파 → forward-fix 범위 재검토 필요(planner FOLLOWUP 후보)');
}

// ---------------------------------------------------------------------------
// AC0-3: forward-durability — registrar_id 매칭 여부로 emit 경로 추정
// ---------------------------------------------------------------------------
line('\n########## AC0-3  forward-durability (착지 경로 추정) ##########');
const withFk = contamDopa.filter(r => r.registrar_id != null).length;
const noFk = contamDopa.filter(r => r.registrar_id == null).length;
line(`  대상셋 registrar_id 매칭: FK有=${withFk}  FK無(NULL)=${noFk}`);
line('  · FK無 = ingest EF 무매칭 fallback 경로 or emit 원본 그대로 착지 → emit payload에 prefix 존재 정황');
line('  · [도파민TM] 라벨 fallback 과 도파민 TM: prefix 는 별개 문자열 — 아래 [도파민TM] 카운트로 구분');
const legacyLabel = rows.filter(r => (r.registrar_name || '').startsWith('[도파민TM]')).length;
line(`  참고: '[도파민TM]' EF fallback 라벨 행 = ${legacyLabel} 건 (본 티켓 대상 아님)`);

line('\n======================================================================');
line('AC0 DIAGNOSE 요약:');
line(`  대상셋 후보(dopamine ∩ prefix) = ${contamDopa.length} 건`);
line(`  staff.name 오염(STOP신호) = ${staffContam.length} / registrar master 오염 = ${regContam.length}`);
line(`  created_by 비-NULL(불변식 위반) = ${createdByNonNull} 건 (기대 0)`);
line('======================================================================');
