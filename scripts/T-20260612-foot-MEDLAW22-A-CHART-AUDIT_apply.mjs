/**
 * T-20260612-foot-MEDLAW22-A-CHART-AUDIT — DRY-RUN → APPLY (prod foot)
 *
 * medical_charts_audit_log 테이블 + trg_medical_charts_body_audit BEFORE UPDATE 트리거 prod 적용.
 * body 20260516_body_061_medical_audit_log.sql 패턴 동일(foot 스키마 정합: clinic_id TEXT, is_approved_user()).
 *
 * 절차:
 *   1) BEFORE 스냅샷 (대상 테이블/트리거/헬퍼 존재, 충돌 사전 확인)
 *   2) DRY-RUN: BEGIN → 마이그(BEGIN/COMMIT strip) → 검증 → ROLLBACK (영속 변경 없음)
 *   3) DRY-RUN PASS 시에만 APPLY: 마이그 원본(자체 BEGIN..COMMIT + DO$$ 검증) 실행
 *   4) AFTER 스냅샷 (테이블/트리거/정책 최종 확인) → 증빙 출력
 *
 * supervisor DB 게이트 경유 요청(FIX-REQUEST MSG-20260612-191252-cgri). DB 마이그는 dev-foot 직접 실행.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260612150000_medical_charts_body_audit.sql';
const rawSql  = fs.readFileSync(migPath, 'utf8');
const txnSql  = rawSql.split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n'); // dry-run용 (외부 트랜잭션 제어)

const qTable = `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='medical_charts_audit_log'`;
const qTrig  = `SELECT tgname FROM pg_trigger WHERE tgrelid='medical_charts'::regclass AND NOT tgisinternal ORDER BY tgname`;
const qHelper= `SELECT proname FROM pg_proc WHERE proname IN ('is_approved_user')`;
const qPol   = `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='medical_charts_audit_log' ORDER BY cmd, policyname`;

await client.connect();
console.log(`✅ DB 연결 (prod foot: rxlomoozakkjesdqjtvd)  ${new Date().toISOString()}\n`);

// ── 1) BEFORE 스냅샷 ──────────────────────────────────────────
console.log('══════════ BEFORE (적용 전 현황) ══════════');
const beforeTable = (await client.query(qTable)).rowCount > 0;
const beforeTrigs = (await client.query(qTrig)).rows.map(r => r.tgname);
const helpers     = (await client.query(qHelper)).rows.map(r => r.proname);
console.log(`  medical_charts_audit_log 테이블 존재: ${beforeTable ? '⚠️ 이미 존재' : '없음(신규 생성 예정)'}`);
console.log(`  medical_charts 트리거: [${beforeTrigs.join(', ') || '(없음)'}]`);
console.log(`  헬퍼 is_approved_user(): ${helpers.includes('is_approved_user') ? '✅ 존재' : '❌ 부재(RLS 정책 깨짐 위험)'}`);
console.log(`  대상 트리거 trg_medical_charts_body_audit 기존 존재: ${beforeTrigs.includes('trg_medical_charts_body_audit') ? '⚠️ 이미 존재(idempotent 재적용)' : '없음'}`);

if (!helpers.includes('is_approved_user')) {
  console.error('\n❌ ABORT: is_approved_user() 헬퍼 부재 — foot RLS 정책 전제 불충족. 적용 중단.');
  await client.end(); process.exit(1);
}

// ── 2) DRY-RUN (BEGIN..ROLLBACK) ──────────────────────────────
console.log('\n══════════ DRY-RUN (BEGIN..ROLLBACK, 영속 변경 없음) ══════════');
let dryPass = true;
try {
  await client.query('BEGIN');
  await client.query(txnSql); // 마이그 본문 (DO$$ 검증 포함, BEGIN/COMMIT만 제거)
  const t = (await client.query(qTable)).rowCount > 0;
  const trigs = (await client.query(qTrig)).rows.map(r => r.tgname);
  const pols  = (await client.query(qPol)).rows;
  const hasTrig = trigs.includes('trg_medical_charts_body_audit');
  const enforceCoexist = trigs.includes('trg_enforce_medchart_signing_doctor');
  const noUpdDel = !pols.some(p => p.cmd === 'UPDATE' || p.cmd === 'DELETE');
  const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) dryPass = false; };
  chk('medical_charts_audit_log 테이블 생성', t);
  chk('trg_medical_charts_body_audit 트리거 생성', hasTrig);
  chk('append-only (UPDATE/DELETE 정책 부재)', noUpdDel);
  console.log(`  ℹ️ 트랜잭션 내 medical_charts 트리거: [${trigs.join(', ')}]`);
  console.log(`  ℹ️ 기존 enforce 트리거 공존: ${enforceCoexist ? '✅' : '⚠️ 부재(경고만, body 패턴상 정상일 수 있음)'}`);
  console.log(`  ℹ️ audit_log RLS 정책: [${pols.map(p=>`${p.policyname}/${p.cmd}`).join(', ')}]`);
} catch (e) {
  dryPass = false;
  console.error(`  ❌ DRY-RUN 적용 중 오류: ${e.message}`);
} finally {
  await client.query('ROLLBACK');
  console.log('  ↩️ ROLLBACK 완료 — prod 영속 변경 없음.');
}
console.log(`\n${dryPass ? '✅ DRY-RUN PASS — 스키마 충돌 없음, 적용 진행' : '❌ DRY-RUN FAIL — 적용 중단'}`);
if (!dryPass) { await client.end(); process.exit(1); }

// ── 3) APPLY (마이그 원본, 자체 BEGIN..COMMIT + DO$$ 검증) ──────
console.log('\n══════════ APPLY (prod 영속 적용) ══════════');
let applyOk = true;
try {
  const res = await client.query(rawSql);
  // node-pg 멀티스테이트먼트: NOTICE 는 client 'notice' 이벤트로 옴. 결과만 확인.
  console.log('  ✅ 마이그레이션 실행 완료 (COMMIT).');
} catch (e) {
  applyOk = false;
  console.error(`  ❌ APPLY 오류: ${e.message}`);
}
if (!applyOk) { await client.end(); process.exit(1); }

// ── 4) AFTER 스냅샷 (영속 확인) ────────────────────────────────
console.log('\n══════════ AFTER (적용 후 검증 — 증빙) ══════════');
const afterTable = (await client.query(qTable)).rowCount > 0;
const afterTrigs = (await client.query(qTrig)).rows.map(r => r.tgname);
const afterPols  = (await client.query(qPol)).rows;
const afterHasTrig = afterTrigs.includes('trg_medical_charts_body_audit');
const afterNoUpdDel = !afterPols.some(p => p.cmd === 'UPDATE' || p.cmd === 'DELETE');
// 컬럼 구조 확인
const cols = (await client.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='medical_charts_audit_log' ORDER BY ordinal_position`)).rows;
// 트리거 함수 SECURITY DEFINER 확인
const fn = (await client.query(
  `SELECT proname, prosecdef FROM pg_proc WHERE proname='medical_charts_body_audit'`)).rows[0];

let finalPass = true;
const fchk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) finalPass = false; };
fchk('medical_charts_audit_log 테이블 영속 존재', afterTable);
fchk('trg_medical_charts_body_audit 트리거 영속 존재', afterHasTrig);
fchk('append-only (UPDATE/DELETE 정책 부재)', afterNoUpdDel);
fchk('medical_charts_body_audit() SECURITY DEFINER', fn && fn.prosecdef === true);
console.log(`  ℹ️ 테이블 컬럼: ${cols.map(c=>`${c.column_name}:${c.data_type}`).join(', ')}`);
console.log(`  ℹ️ medical_charts 트리거(최종): [${afterTrigs.join(', ')}]`);
console.log(`  ℹ️ audit_log RLS 정책(최종): [${afterPols.map(p=>`${p.policyname}/${p.cmd}`).join(', ')}]`);

await client.end();
console.log(`\n${finalPass ? '✅✅ APPLY 검증 PASS — prod 적용 완료' : '❌ APPLY 후 검증 실패 — 확인 필요'}`);
console.log(`종료 ${new Date().toISOString()}`);
process.exit(finalPass ? 0 : 1);
