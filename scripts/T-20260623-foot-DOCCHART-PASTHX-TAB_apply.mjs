/**
 * T-20260623-foot-DOCCHART-PASTHX-TAB — gated apply (AC-2 영속화)
 *
 * 목적: patient_past_history 신규 테이블을 PROD(rxlomoozakkjesdqjtvd)에 적용.
 *   의사 진료차트 '과거력' 탭 — 실장 더블체크·확정값 영속화 저장소.
 *   DA CONSULT-REPLY GO (MSG-20260623-202836-fqrs, ADDITIVE·파괴0·계약충돌0, 옵션 a 신규테이블).
 *   autonomy §3.1: ADDITIVE 신규테이블 → 대표게이트 면제, supervisor DDL-diff만.
 *
 * 흐름:
 *   [A] read-only audit — 테이블 존재여부 사전측정.
 *   [B] CREATE TABLE apply — supabase/migrations/20260623180000_patient_past_history.sql
 *       (ADDITIVE·멱등 IF NOT EXISTS·기존테이블 무변경·backfill 불요.)
 *   [C] NOTIFY pgrst reload schema → PostgREST 스키마 캐시 반영.
 *   [D] post-verify — 테이블·컬럼·RLS enabled·정책 3종·인덱스 2종.
 *
 * 실행:
 *   node scripts/T-20260623-foot-DOCCHART-PASTHX-TAB_apply.mjs           # audit-only
 *   node scripts/T-20260623-foot-DOCCHART-PASTHX-TAB_apply.mjs --apply    # 적용
 *
 * 롤백: 20260623180000_patient_past_history.rollback.sql (DROP TABLE IF EXISTS patient_past_history;)
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
  join(REPO, 'supabase/migrations/20260623180000_patient_past_history.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260623-foot-DOCCHART-PASTHX-TAB_evidence.md');

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

(async () => {
  await client.connect();
  out('# T-20260623-foot-DOCCHART-PASTHX-TAB — DB-gate evidence');
  out(`- db: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out(`- ADDITIVE 신규테이블 patient_past_history (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만, DA GO MSG-fqrs)`);
  out('');

  // ── [A] read-only audit ──
  out('## [A] read-only audit (pre)');
  const { rows: tabPre } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name='patient_past_history';`);
  const tabExistsPre = tabPre.length > 0;
  out('```');
  out(`patient_past_history 테이블(적용 전): ${tabExistsPre ? '이미 존재' : '없음(신설 대상)'}`);
  out('```');

  if (!DO_APPLY) {
    out('\n✋ audit-only: --apply 미지정 → 적용 미실행.');
    await client.end(); flush(); process.exit(0);
  }

  // ── [B] CREATE TABLE apply (ADDITIVE·멱등) ──
  out('\n## [B] CREATE TABLE apply (20260623180000)');
  await client.query(MIG);
  out('✅ CREATE TABLE IF NOT EXISTS patient_past_history + indexes + RLS + 3 policies 적용 완료');

  // ── [C] PostgREST schema cache reload ──
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out("\n## [C] NOTIFY pgrst 'reload schema' 전송");

  // ── [D] post-verify ──
  out('\n## [D] post-verify');
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name='patient_past_history' ORDER BY ordinal_position;`);
  out('```');
  out('컬럼:');
  for (const c of cols) out(`  ${c.column_name} | ${c.data_type} | nullable=${c.is_nullable}`);
  const { rows: rls } = await client.query(`
    SELECT relrowsecurity FROM pg_class WHERE relname='patient_past_history';`);
  out(`RLS enabled: ${rls[0]?.relrowsecurity}`);
  const { rows: pols } = await client.query(`
    SELECT polname, polcmd FROM pg_policy
    WHERE polrelid='patient_past_history'::regclass ORDER BY polname;`);
  out('정책:');
  for (const p of pols) out(`  ${p.polname} (${p.polcmd})`);
  const { rows: idx } = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='patient_past_history' ORDER BY indexname;`);
  out('인덱스:');
  for (const i of idx) out(`  ${i.indexname}`);
  out('```');

  const expectCols = ['id','clinic_id','customer_id','lines','comment','confirmed_by','confirmed_at'];
  const gotCols = cols.map(c => c.column_name);
  const colsOk = expectCols.every(c => gotCols.includes(c));
  const rlsOk = rls[0]?.relrowsecurity === true;
  const polsOk = pols.length >= 3;
  const idxOk = idx.some(i => i.indexname === 'idx_pph_customer') && idx.some(i => i.indexname === 'idx_pph_clinic');
  const ok = colsOk && rlsOk && polsOk && idxOk;
  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out(`- 컬럼 7종: ${colsOk ? 'OK' : 'FAIL — got ' + gotCols.join(',')}`);
  out(`- RLS enabled: ${rlsOk ? 'OK' : 'FAIL'}`);
  out(`- 정책 ≥3: ${polsOk ? 'OK (' + pols.length + ')' : 'FAIL (' + pols.length + ')'}`);
  out(`- 인덱스 idx_pph_customer/idx_pph_clinic: ${idxOk ? 'OK' : 'FAIL'}`);
  out('- 롤백: 20260623180000_patient_past_history.rollback.sql (DROP TABLE IF EXISTS patient_past_history;)');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
