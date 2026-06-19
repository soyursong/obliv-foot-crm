/**
 * T-20260616-foot-OPINION-DOC-FEATURE (Phase 2) — PROD APPLY (영속)
 * dev-foot 직접 DB 적용 (메모리 'dev-foot DB 마이그레이션 직접 실행', 대시보드 수동 금지).
 *
 * 게이트: supervisor DDL-diff GO 완료 (ADDITIVE, 롤백 포함 — MSG-20260619-155216-t73s).
 *         대표 게이트 면제(autonomy §3.1, 파괴 0). prod_apply_gate=supervisor-ddl-diff-GO.
 *
 * 마이그: 20260616160000_opinion_doc_form_stack.sql (정본, BEGIN/COMMIT 내장)
 *   - C1 published 비가역 트리거 + form_submissions_update USING status<>'published'
 *   - opinion_doc form_template seed (ON CONFLICT idempotent)
 *   - is_doctor_role() 표준함수 + publish_opinion_doc RPC (C2 isDoctorRole 게이트)
 *
 * ★ 적용시점 실측(2026-06-19): 현 prod published 행 = 2건 (둘 다 koh_result).
 *    C1 트리거가 이 2건을 비가역 보호하게 됨 = 설계 의도(KOH 발행본 동시 보호, 의료법 §22).
 *    KOH published=종단 상태 → 정상 흐름에 published UPDATE/DELETE 없음 → 회귀 0.
 *    (마이그 주석 '0건' 전제는 6/16 probe 기준 — 6/16 이후 KOH 발급 2건 누적, 보호대상 정상.)
 *
 * 흐름: 0) PRE-SNAP READ-only (객체 부재 + published 행수)
 *       1) DRY-RUN: BEGIN → 마이그 본문(BEGIN/COMMIT 제거) → ROLLBACK (영속 0, 유효성)
 *       2) 실적용: 마이그(BEGIN/COMMIT + 내장 verify DO) 그대로 실행
 *       3) 별도 연결 POST 검증: RPC/함수/트리거/템플릿/술어 존재 + published 2건 무손실
 * 실패 시: 20260616160000_opinion_doc_form_stack.rollback.sql 로 복구.
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260616160000_opinion_doc_form_stack.sql';
const sql = fs.readFileSync(migPath, 'utf8');
// DRY-RUN: 외부 BEGIN/ROLLBACK 으로 감싸기 위해 내장 트랜잭션 키워드 제거
const sqlBody = sql.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

const DRY = process.argv.includes('--dry-run');

const SNAP = async (c, tag) => {
  const o = {};
  o.rpc      = (await c.query("SELECT count(*)::int n FROM pg_proc WHERE proname='publish_opinion_doc'")).rows[0].n;
  o.isdoc    = (await c.query("SELECT count(*)::int n FROM pg_proc WHERE proname='is_doctor_role'")).rows[0].n;
  o.trigger  = (await c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='trg_form_submissions_published_immutable' AND NOT tgisinternal")).rows[0].n;
  o.template = (await c.query("SELECT count(*)::int n FROM form_templates WHERE form_key='opinion_doc'")).rows[0].n;
  o.pubPred  = (await c.query("SELECT COALESCE(bool_or(qual LIKE '%published%'),false) b FROM pg_policies WHERE tablename='form_submissions' AND policyname='form_submissions_update'")).rows[0].b;
  o.pubRows  = (await c.query("SELECT count(*)::int n FROM form_submissions WHERE status='published'")).rows[0].n;
  console.log(`  [${tag}] rpc=${o.rpc} isDoctor=${o.isdoc} trigger=${o.trigger} template=${o.template} pubPredicate=${o.pubPred} publishedRows=${o.pubRows}`);
  return o;
};

// ── 0) PRE-SNAP ──
const c0 = conn(); await c0.connect();
console.log(`✅ DB 연결 (PRE-SNAP) ${new Date().toISOString()}`);
const before = await SNAP(c0, 'PRE');
await c0.end();

// ── 1) DRY-RUN (영속 0) ──
{
  const c = conn(); await c.connect();
  console.log(`\n── DRY-RUN (BEGIN→본문→ROLLBACK, 영속 0) ──`);
  try {
    await c.query('BEGIN');
    await c.query(sqlBody);   // 본문(내장 verify DO 포함)이 tx 내에서 통과해야 함
    await c.query('ROLLBACK');
    console.log('✅ DRY-RUN PASS — 전 DDL + 내장 verify DO 통과, ROLLBACK(영속 0)');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('❌ DRY-RUN FAIL:', e.message);
    await c.end(); process.exit(1);
  }
  await c.end();
}

if (DRY) { console.log('\n--dry-run 모드: 실적용 생략.'); process.exit(0); }

// ── 2) 실적용 (마이그 BEGIN/COMMIT 내장 그대로) ──
{
  const c = conn(); await c.connect();
  console.log(`\n── 실적용 (마이그 트랜잭션 + 내장 verify DO) ──`);
  try {
    await c.query(sql);
    console.log('✅ 실적용 COMMIT 완료');
  } catch (e) {
    console.error('❌ 실적용 FAIL (트랜잭션 자동 롤백):', e.message);
    await c.end(); process.exit(1);
  }
  await c.end();
}

// ── 3) POST 검증 (별도 연결) ──
{
  const c = conn(); await c.connect();
  console.log(`\n── POST 검증 ──`);
  const after = await SNAP(c, 'POST');
  await c.end();
  const ok =
    after.rpc === 1 && after.isdoc === 1 && after.trigger === 1 &&
    after.template === 1 && after.pubPred === true &&
    after.pubRows === before.pubRows; // 기존 published 무손실
  console.log(`\n결과: ${ok ? '✅ APPLY OK' : '❌ APPLY 검증 실패'} (published 무손실: ${after.pubRows}==${before.pubRows})`);
  process.exit(ok ? 0 : 1);
}
