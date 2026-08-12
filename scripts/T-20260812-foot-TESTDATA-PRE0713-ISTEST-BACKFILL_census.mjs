/**
 * T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — 1단계 CENSUS (READ-ONLY, prod write 0)
 *
 * 목적(티켓 §1 착수순서 1단계):
 *   ① is_test 컬럼 실재: check_ins·payments·packages(+ 연관 money-grain) 전체에 is_test 컬럼이 있는가?
 *   ② canonical 기준 컬럼: 테이블별 생성일 판정 컬럼(created_at vs visit_date) 확정.
 *   ③ 대상 row 수 사전 count(dry-run 기준): 기준일 < 2026-07-13 00:00:00 KST AND is_test IN (false, NULL).
 *   ④ 7/13 경계행 존재 여부: 7/13 00:00:00 KST 정각 근방 경계행 → reporter 재확인 트리거.
 *   ⑤ [추가] is_simulation 축 실재/현황 — foot 매출 유니버스 필터는 is_simulation 이므로 병기 조사.
 *
 * ★★★ READ-ONLY. UPDATE/DELETE/INSERT 절대 없음. prod write 0. ★★★
 * ★★★ 실 정정(apply)은 supervisor DB-GATE GO-token 후에만. 본 스크립트는 census 증거 생성 전용. ★★★
 *
 * PHI 위생: 개인식별 콘솔출력 금지. 집계 count / 컬럼존재 boolean 만 출력.
 * author: dev-foot / 2026-08-12
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 컷오프 (티켓 cutoff_interpretation): 2026-07-13 이전 = 7/12 23:59:59 KST 까지 = < 2026-07-13T00:00:00+09:00
const CUTOFF_KST = '2026-07-13T00:00:00+09:00';
// 7/13 경계행 스캔 윈도우: 7/13 00:00:00 ~ 7/13 00:00:00 정각 근방(±1일) 존재확인
const BOUNDARY_LO = '2026-07-13T00:00:00+09:00';
const BOUNDARY_HI = '2026-07-14T00:00:00+09:00';

// 후보 대상 테이블 + 후보 기준컬럼(있는 것만 사용)
const TABLES = [
  { t: 'check_ins',        dateCands: ['created_at', 'visit_date', 'checked_in_at'] },
  { t: 'payments',         dateCands: ['created_at', 'accounting_date', 'paid_at'] },
  { t: 'packages',         dateCands: ['created_at', 'purchased_at', 'start_date'] },
  { t: 'package_payments', dateCands: ['created_at', 'accounting_date', 'paid_at'] },
  { t: 'service_charges',  dateCands: ['created_at', 'accounting_date'] },
  { t: 'customers',        dateCands: ['created_at'] },
];
const FLAG_CANDS = ['is_test', 'is_simulation'];

// information_schema 로 실제 컬럼 존재 확인
async function columnsOf(table) {
  const { data, error } = await sb.rpc('exec_sql_readonly', { q: null }).then(() => ({ data: null, error: 'no-rpc' }))
    .catch(() => ({ data: null, error: 'no-rpc' }));
  // exec RPC 미보장 → PostgREST 로 컬럼 존재는 select 시도로 판정(아래 probeColumn)
  return null;
}

// 특정 컬럼 존재여부 = 최소 select 시도(에러코드 42703 = 컬럼부재).
// ※ head:true count 요청은 에러 body 가 비어 42703 를 못 읽음 → 반드시 non-head select 로 판정.
async function probeColumn(table, col) {
  const { error } = await sb.from(table).select(col).limit(1);
  if (!error) return true;
  const msg = (error.message || '') + ' ' + (error.code || '') + ' ' + (error.details || '');
  if (/does not exist|42703|could not find|schema cache/i.test(msg)) return false;
  return `ERR:${error.code || ''}:${(error.message || '').slice(0, 60)}`;
}

async function tableExists(table) {
  const { error } = await sb.from(table).select('*', { head: true, count: 'exact' }).limit(1);
  if (!error) return true;
  const msg = (error.message || '') + ' ' + (error.code || '');
  if (/does not exist|42P01|could not find/i.test(msg)) return false;
  return `ERR:${error.code || ''}:${(error.message || '').slice(0, 60)}`;
}

async function countWhere(table, build) {
  let q = sb.from(table).select('*', { head: true, count: 'exact' });
  q = build(q);
  const { count, error } = await q;
  if (error) return `ERR:${error.code || ''}:${(error.message || '').slice(0, 80)}`;
  return count;
}

async function main() {
  console.log('=== T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — 1단계 CENSUS (READ-ONLY) ===');
  console.log(`DB: ${SUPABASE_URL}`);
  console.log(`컷오프(KST): 대상 = 기준일 < ${CUTOFF_KST}  (= 7/12 23:59:59 까지 생성분)`);
  console.log(`7/13 경계행 스캔: [${BOUNDARY_LO}, ${BOUNDARY_HI})\n`);

  const report = { generated_axis: 'READ-ONLY', tables: {} };

  for (const { t, dateCands } of TABLES) {
    const exists = await tableExists(t);
    const rec = { table: t, table_exists: exists, flags: {}, date_cols: {}, total: null, pre_cutoff: {}, boundary: {} };
    if (exists !== true) { report.tables[t] = rec; console.log(`\n── ${t}: TABLE ${exists}`); continue; }

    rec.total = await countWhere(t, q => q);

    // 플래그 컬럼 실재
    for (const f of FLAG_CANDS) rec.flags[f] = await probeColumn(t, f);
    // 기준(날짜) 컬럼 실재
    for (const d of dateCands) rec.date_cols[d] = await probeColumn(t, d);

    // canonical 기준컬럼 = 후보 중 최초로 존재하는 것
    const canonicalDate = dateCands.find(d => rec.date_cols[d] === true) || null;
    rec.canonical_date = canonicalDate;

    // 대상 count (is_test 기준) — is_test 존재 시에만
    if (rec.flags.is_test === true && canonicalDate) {
      // 대상: 기준일 < cutoff AND is_test IN (false, NULL)
      rec.pre_cutoff.by_is_test = await countWhere(t, q =>
        q.lt(canonicalDate, CUTOFF_KST).or('is_test.is.null,is_test.eq.false'));
      rec.pre_cutoff.already_true = await countWhere(t, q =>
        q.lt(canonicalDate, CUTOFF_KST).eq('is_test', true));
    } else {
      rec.pre_cutoff.by_is_test = 'N/A(is_test 컬럼 부재 또는 기준컬럼 부재)';
    }

    // 참고: is_simulation 축 대상 count (foot 매출 유니버스 실제 필터축)
    if (rec.flags.is_simulation === true && canonicalDate) {
      rec.pre_cutoff.by_is_sim = await countWhere(t, q =>
        q.lt(canonicalDate, CUTOFF_KST).or('is_simulation.is.null,is_simulation.eq.false'));
      rec.pre_cutoff.sim_already_true = await countWhere(t, q =>
        q.lt(canonicalDate, CUTOFF_KST).eq('is_simulation', true));
    }

    // 전체 pre-cutoff (플래그 무관) — 규모 파악
    if (canonicalDate) {
      rec.pre_cutoff.all_rows = await countWhere(t, q => q.lt(canonicalDate, CUTOFF_KST));
      // 7/13 경계행
      rec.boundary.rows_on_0713 = await countWhere(t, q =>
        q.gte(canonicalDate, BOUNDARY_LO).lt(canonicalDate, BOUNDARY_HI));
    }

    report.tables[t] = rec;
    console.log(`\n── ${t} (total=${rec.total}) canonical_date=${canonicalDate}`);
    console.log(`   flags: ${JSON.stringify(rec.flags)}`);
    console.log(`   date_cols: ${JSON.stringify(rec.date_cols)}`);
    console.log(`   pre_cutoff: ${JSON.stringify(rec.pre_cutoff)}`);
    console.log(`   boundary(7/13): ${JSON.stringify(rec.boundary)}`);
  }

  console.log('\n\n=== CENSUS JSON ===');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error('CENSUS FAILED:', e.message); process.exit(1); });
