/**
 * T-20260624-foot-CHART2-MEMO-EDIT-DELETE — gated apply
 *
 * 목적: 2번차트 메모 soft-delete(deleted_at/deleted_by) + admin/manager/director 관리권한 RLS를
 *   DB(rxlomoozakkjesdqjtvd)에 적용. FE(commit 6264679f)는 이미 라이브이며 .is('deleted_at',null)
 *   필터를 사용 → 컬럼 미적용 시 메모 이력 패널이 'unavailable'로 회귀(기존 메모 숨김). 본 적용으로 정합 회복.
 *
 * 변경(3 이력테이블 공통): customer_treatment_memos / customer_reservation_memos / customer_consult_memos
 *   1. deleted_at/deleted_by 2컬럼 ADDITIVE(IF NOT EXISTS·nullable·DEFAULT 없음·backfill 불요).
 *   2. UPDATE RLS: 본인(created_by) OR admin/manager/director.
 *   3. DELETE RLS 제거(의료법 §22-3/§40 진료기록 보존 — hard-delete 금지, soft-delete만).
 *   멱등(IF NOT EXISTS / DROP POLICY IF EXISTS) — 재실행 안전.
 *   autonomy §3.1: ADDITIVE → 대표게이트 면제, supervisor DDL-diff만.
 *
 * 실행:
 *   node scripts/T-20260624-foot-CHART2-MEMO-EDIT-DELETE_apply.mjs           # audit-only
 *   node scripts/T-20260624-foot-CHART2-MEMO-EDIT-DELETE_apply.mjs --apply    # 적용
 *
 * 롤백: supabase/migrations/20260624160000_memo_soft_delete_role_manage.down.sql
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DO_APPLY = process.argv.includes('--apply');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}
const MIG = readFileSync(
  join(REPO, 'supabase/migrations/20260624160000_memo_soft_delete_role_manage.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260624-foot-CHART2-MEMO-EDIT-DELETE_evidence.md');
const TABLES = ['customer_treatment_memos', 'customer_reservation_memos', 'customer_consult_memos'];

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const flush = () => {
  try { mkdirSync(dirname(EVID), { recursive: true }); writeFileSync(EVID, log.join('\n') + '\n'); console.log('\n📄 evidence →', EVID); }
  catch (e) { console.error('evidence write fail:', e.message); }
};

const auditCols = async () => {
  const { rows } = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1)
      AND column_name IN ('deleted_at','deleted_by')
    ORDER BY table_name, column_name;`, [TABLES]);
  return rows;
};
const auditPolicies = async () => {
  const { rows } = await client.query(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname='public' AND tablename = ANY($1)
    ORDER BY tablename, policyname;`, [TABLES]);
  return rows;
};

(async () => {
  await client.connect();
  out('# T-20260624-foot-CHART2-MEMO-EDIT-DELETE — DB-gate evidence');
  out(`- db: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out('- ADDITIVE deleted_at/deleted_by ×3 + role-manage UPDATE RLS + DELETE RLS 제거(의료법 hard-delete 금지)');
  out('- 동기: FE(6264679f) 라이브 + .is(deleted_at,null) → 컬럼 미적용 시 메모이력 회귀. 정합 회복.');
  out('');

  // ── [A] read-only audit (pre) ──
  out('## [A] read-only audit (pre)');
  out('```');
  out('soft-delete 컬럼(적용 전):');
  const colPre = await auditCols();
  out(colPre.length ? JSON.stringify(colPre, null, 0) : '없음(3테이블 신설 대상)');
  out('\n정책(적용 전):');
  for (const p of await auditPolicies()) out(`  ${p.tablename}.${p.policyname} [${p.cmd}]`);
  out('```');

  if (!DO_APPLY) {
    out('\n✋ audit-only: --apply 미지정 → 적용 미실행.');
    await client.end(); flush(); process.exit(0);
  }

  // ── [B] migration apply (멱등·BEGIN/COMMIT 포함) ──
  out('\n## [B] migration apply (20260624160000_memo_soft_delete_role_manage)');
  await client.query(MIG);
  out('✅ deleted_at/deleted_by ×3 + manage_update_* RLS + DELETE RLS drop 적용 완료');

  // ── [C] PostgREST schema cache reload ──
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out("\n## [C] NOTIFY pgrst 'reload schema' 전송");

  // ── [D] post-verify ──
  out('\n## [D] post-verify');
  const colPost = await auditCols();
  const polPost = await auditPolicies();
  out('```');
  out('soft-delete 컬럼(적용 후):');
  out(JSON.stringify(colPost, null, 0));
  out('\n정책(적용 후):');
  for (const p of polPost) out(`  ${p.tablename}.${p.policyname} [${p.cmd}]`);
  out('```');

  // 검증: 3테이블 × (deleted_at + deleted_by) = 6컬럼, manage_update_* 3정책, *_delete_* 정책 0
  const colOk = colPost.length === 6 &&
    colPost.every((c) => c.is_nullable === 'YES');
  const manageUpd = polPost.filter((p) => /^manage_update_/.test(p.policyname) && p.cmd === 'UPDATE');
  const upcOk = manageUpd.length === 3;
  const delLeft = polPost.filter((p) => /_delete_/.test(p.policyname) || p.cmd === 'DELETE');
  const delOk = delLeft.length === 0;
  const ok = colOk && upcOk && delOk;

  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out(`- soft-delete 컬럼 6개 nullable: ${colOk ? 'OK' : 'FAIL — ' + colPost.length + '개'}`);
  out(`- manage_update_* UPDATE 정책 3개: ${upcOk ? 'OK' : 'FAIL — ' + manageUpd.length + '개'}`);
  out(`- DELETE 정책 잔존 0(hard-delete 차단): ${delOk ? 'OK' : 'FAIL — ' + JSON.stringify(delLeft)}`);
  out('- 롤백: psql -f supabase/migrations/20260624160000_memo_soft_delete_role_manage.down.sql');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
