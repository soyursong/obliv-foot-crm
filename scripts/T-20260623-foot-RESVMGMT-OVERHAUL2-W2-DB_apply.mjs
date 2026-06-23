/**
 * T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB — gated apply (item 2/3/8/10)
 *
 * 목적: 예약관리 개편2탄 WAVE 2 DB 변경 2종을 PROD(rxlomoozakkjesdqjtvd)에 적용.
 *   (1) reservations.brief_note TEXT NULL 신규 (초진 간략메모 전용 컬럼 — memo 오버로드 금지).
 *   (2) customers/reservations visit_route CHECK 제약에 '네이버','인콜' ADD (B안: 기존 4값 전부 존치).
 *   DA CONSULT-REPLY MSG-20260623-182336-igq8: 둘 다 GO + 순수 ADDITIVE.
 *   autonomy §3.1: ADDITIVE → 대표게이트 면제, supervisor DDL-diff 게이트만.
 *
 * ★ 이름충돌 경고(코드 주석 동기화): cue_cards.media_source='naver'(paid) ≠ foot.visit_route '네이버'(수기 inbound).
 *   route_std 매핑(contract §364-366): '네이버'→naver / '인콜'→inbound / legacy '인바운드'→inbound.
 *
 * 흐름:
 *   [A] read-only audit — brief_note 존재여부 + visit_route CHECK 정의 사전측정(DDL-diff 근거).
 *   [B] apply — supabase/migrations/20260624100000_resvmgmt_overhaul2_w2.sql (멱등·ADDITIVE·BEGIN/COMMIT).
 *   [C] NOTIFY pgrst reload schema → PostgREST 스키마 캐시 반영(brief_note 즉시 인식).
 *   [D] post-verify — brief_note 컬럼 + 두 CHECK 제약이 '네이버'/'인콜' 포함 + legacy '인바운드' 존치.
 *
 * 실행:
 *   node scripts/T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB_apply.mjs            # audit-only (DDL-diff)
 *   node scripts/T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB_apply.mjs --apply     # 적용
 *
 * 롤백: 20260624100000_resvmgmt_overhaul2_w2.rollback.sql
 *   (brief_note DROP + CHECK 4값 원복 — '네이버'/'인콜' 행 선정리 필요, 주석 참조)
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
  join(REPO, 'supabase/migrations/20260624100000_resvmgmt_overhaul2_w2.sql'),
  'utf8',
);
const EVID = join(REPO, 'db-gate', 'T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB_evidence.md');

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

const checkDef = async (conname) => {
  const { rows } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname=$1;`, [conname]);
  return rows[0]?.def ?? '(없음)';
};

(async () => {
  await client.connect();
  out('# T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB — DB-gate evidence');
  out(`- db: rxlomoozakkjesdqjtvd | ${new Date().toISOString()} | mode: ${DO_APPLY ? 'AUDIT+APPLY' : 'AUDIT-ONLY'}`);
  out('- ADDITIVE 2종: (1) reservations.brief_note TEXT (2) visit_route CHECK +네이버/+인콜(인바운드 존치, B안)');
  out('- DA GO MSG-igq8 (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만)');
  out('');

  // ── [A] read-only audit (DDL-diff pre) ──
  out('## [A] read-only audit (pre) — DDL-diff 근거');
  const { rows: bnPre } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reservations' AND column_name='brief_note';`);
  const bnExistsPre = bnPre.length > 0;
  out('```');
  out(`reservations.brief_note (적용 전): ${bnExistsPre ? '이미 존재' : '없음(신설 대상)'}`);
  out(`customers_visit_route_check (적용 전): ${await checkDef('customers_visit_route_check')}`);
  out(`reservations_visit_route_check (적용 전): ${await checkDef('reservations_visit_route_check')}`);
  out('```');

  if (!DO_APPLY) {
    out('\n✋ audit-only: --apply 미지정 → 적용 미실행. supervisor DDL-diff 게이트 후 --apply.');
    await client.end(); flush(); process.exit(0);
  }

  // ── [B] apply (멱등·ADDITIVE·BEGIN/COMMIT 내장) ──
  out('\n## [B] apply (20260624100000_resvmgmt_overhaul2_w2.sql)');
  await client.query(MIG);
  out('✅ brief_note ADD + visit_route CHECK 재생성(+네이버/+인콜, 인바운드 존치) 적용 완료');

  // ── [C] PostgREST schema cache reload ──
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out("\n## [C] NOTIFY pgrst 'reload schema' 전송");

  // ── [D] post-verify ──
  out('\n## [D] post-verify');
  const { rows: bnPost } = await client.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reservations' AND column_name='brief_note';`);
  const custDef = await checkDef('customers_visit_route_check');
  const resvDef = await checkDef('reservations_visit_route_check');
  out('```');
  out(`brief_note: ${bnPost.length ? `${bnPost[0].column_name} | ${bnPost[0].data_type} | nullable=${bnPost[0].is_nullable}` : 'FAIL(없음)'}`);
  out(`customers_visit_route_check: ${custDef}`);
  out(`reservations_visit_route_check: ${resvDef}`);
  out('```');

  const bnOk = bnPost.length === 1 && bnPost[0].is_nullable === 'YES';
  const hasAll = (d) => ['네이버', '인콜', '인바운드', 'TM', '워크인', '지인소개'].every((v) => d.includes(v));
  const custOk = hasAll(custDef);
  const resvOk = hasAll(resvDef);
  const ok = bnOk && custOk && resvOk;
  out(`\n## [결과] ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  out(`- reservations.brief_note TEXT NULL: ${bnOk ? 'OK' : 'FAIL'}`);
  out(`- customers CHECK 네이버/인콜 ADD + 인바운드 존치(legacy 비파괴): ${custOk ? 'OK' : 'FAIL'}`);
  out(`- reservations CHECK 네이버/인콜 ADD + 인바운드 존치(legacy 비파괴): ${resvOk ? 'OK' : 'FAIL'}`);
  out('- 롤백: 20260624100000_resvmgmt_overhaul2_w2.rollback.sql');
  await client.end(); flush(); process.exit(ok ? 0 : 3);
})().catch((e) => { out('❌ 실패: ' + e.message); flush(); process.exit(1); });
