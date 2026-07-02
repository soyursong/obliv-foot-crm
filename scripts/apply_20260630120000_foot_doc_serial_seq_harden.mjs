/**
 * T-20260629-foot-SERIAL-UNIQUE-HARDEN (페어 T-20260630-foot-SERIAL-RPC-FE-REWIRE)
 * 서류 연번호 동시발번 중복 차단 — doc_serial_seq INT + backfill + RPC + partial UNIQUE INDEX.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * ⚠ supervisor DDL-diff 게이트 통과 후에만 실행.
 *   ★최종 정본 = DA re-CONSULT#3-AMENDMENT LEAVENULL-4 (MSG-20260702-173946-fdqy):
 *     backfill non-published 한정(published 7행 seq NULL 잔존) + assert 재정의(MAX=발번행수 NOT NULL).
 *     의료 immutable guard 무접촉(OPT1/OPT4 supersede) → 의료·대표 게이트 불요, supervisor DDL-diff만.
 *   ADDITIVE: ADD COLUMN nullable / backfill 신규컬럼만(non-published) / partial unique / 신규 RPC. 기존행 mutation0.
 *
 * 2-phase 실행 (CONCURRENTLY 는 트랜잭션 밖 단독 실행 필수):
 *   Phase 1 (harden):  ADD COLUMN + backfill + 중복0 assert + RPC  (BEGIN/COMMIT, 1콜)
 *   Phase 2 (idx):     CREATE UNIQUE INDEX CONCURRENTLY            (트랜잭션 밖, 별도 콜)
 *   → Phase1 COMMIT(중복0 확인) 후 Phase2 인덱스 생성(의무④ 순서).
 *
 * 사용:
 *   node scripts/apply_20260630120000_foot_doc_serial_seq_harden.mjs            # Phase1+2 적용
 *   node scripts/apply_20260630120000_foot_doc_serial_seq_harden.mjs --idx-only # Phase2(인덱스)만
 *   node scripts/apply_20260630120000_foot_doc_serial_seq_harden.mjs --rollback # 인덱스→컬럼/RPC 역순 롤백
 *   node scripts/apply_20260630120000_foot_doc_serial_seq_harden.mjs --verify   # 적용 후 검증 쿼리만
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const MIG = '../supabase/migrations';
const args = process.argv.slice(2);
const rollback = args.includes('--rollback');
const idxOnly = args.includes('--idx-only');
const verifyOnly = args.includes('--verify');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

const runSql = async (sql, label) => {
  console.log(`\n▶ ${label}`);
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await resp.json();
  console.log('  status:', resp.status);
  console.log('  result:', JSON.stringify(body));
  if (!resp.ok) { console.error(`❌ ${label} 실패`); process.exit(1); }
  return body;
};

const read = (f) => readFileSync(join(__dir, MIG, f), 'utf8');

// ★LEAVENULL-4: mx=발번행수(NOT NULL) per-clinic (published seq NULL 제외) + published 행 seq 전량 NULL 확인.
const VERIFY_SQL = `select
     (select count(*) from information_schema.columns where table_name='form_submissions' and column_name='doc_serial_seq') as col,
     (select count(*) from pg_proc where proname='issue_foot_doc_serial') as rpc,
     (select count(*) from pg_class i join pg_index x on x.indexrelid=i.oid
        where i.relname='uq_form_submissions_clinic_doc_serial_seq' and x.indisvalid) as valid_idx,
     (select bool_and(mx=issued) from (
        select coalesce(max(doc_serial_seq),0) mx,
               count(*) filter (where doc_serial_seq is not null) issued
          from form_submissions group by clinic_id) t) as max_eq_issued,
     (select count(*) from form_submissions where status='published' and doc_serial_seq is not null) as published_seq_nonnull`;
const VERIFY_LABEL = 'VERIFY (col=1 rpc=1 valid_idx=1 max_eq_issued=true published_seq_nonnull=0 기대)';

if (verifyOnly) {
  await runSql(VERIFY_SQL, VERIFY_LABEL);
  process.exit(0);
}

if (rollback) {
  // 역순: 인덱스(CONCURRENTLY) → 컬럼/RPC
  await runSql(read('20260630120001_foot_doc_serial_seq_unique_idx.rollback.sql'), 'ROLLBACK Phase2 (DROP INDEX CONCURRENTLY)');
  await runSql(read('20260630120000_foot_doc_serial_seq_harden.rollback.sql'), 'ROLLBACK Phase1 (DROP FUNCTION + COLUMN)');
  console.log('\n✅ ROLLBACK 완료');
  process.exit(0);
}

if (!idxOnly) {
  await runSql(read('20260630120000_foot_doc_serial_seq_harden.sql'), 'APPLY Phase1 (COLUMN + backfill + assert + RPC)');
}
// Phase2: CONCURRENTLY — 트랜잭션 밖 단독 콜.
await runSql(read('20260630120001_foot_doc_serial_seq_unique_idx.sql'), 'APPLY Phase2 (UNIQUE INDEX CONCURRENTLY)');

// 자동 검증 (LEAVENULL-4 기준)
await runSql(VERIFY_SQL, VERIFY_LABEL);

console.log('\n✅ APPLY 완료 — supervisor 검증쿼리(파일 말미) 대조 후 배포 게이트 종결');
