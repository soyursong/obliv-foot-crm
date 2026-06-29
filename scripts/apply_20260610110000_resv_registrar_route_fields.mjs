/**
 * T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS — DB-gate idempotent (re)apply + verify
 *
 * supervisor FIX-REQUEST (MSG-20260611-081226-7voz, qa_fail_phase1 db_gate_apply_required).
 * 이전 probe(20:39): 마이그 HALF-APPLIED — reservation_registrars EXISTS / reservations 3컬럼 MISSING.
 * 해소: 전체 마이그 SQL을 idempotent(IF NOT EXISTS) 재적용 → 누락 3컬럼 + seed 보충.
 *
 * additive only. 기존 데이터 무손실. 롤백 SQL: 20260610110000_resv_registrar_route_fields.rollback.sql
 * 실행: node scripts/apply_20260610110000_resv_registrar_route_fields.mjs
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const MIG_SQL = readFileSync(
  join(REPO, 'supabase/migrations/20260610110000_resv_registrar_route_fields.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS_evidence.md');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };

async function probe() {
  // 테이블
  const { rows: tbl } = await client.query(
    `SELECT to_regclass('public.reservation_registrars') AS t`,
  );
  // reservations 3컬럼
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='reservations'
        AND column_name = ANY($1::text[])`,
    [['visit_route', 'registrar_id', 'registrar_name']],
  );
  const colSet = new Set(cols.map((c) => c.column_name));
  // CHECK 제약
  const { rows: chk } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname='reservations_visit_route_check'`,
  );
  // RLS 정책
  const { rows: pol } = await client.query(
    `SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='reservation_registrars'
      ORDER BY policyname`,
  );
  // seed rows (group_name별 카운트)
  let seed = [];
  if (tbl[0].t) {
    const { rows } = await client.query(
      `SELECT group_name, count(*)::int AS n FROM public.reservation_registrars
        GROUP BY group_name ORDER BY group_name`,
    );
    seed = rows;
  }
  // 트리거
  const { rows: trg } = await client.query(
    `SELECT tgname FROM pg_trigger WHERE tgname='trg_reservation_registrars_updated_at' AND NOT tgisinternal`,
  );
  return { tbl: !!tbl[0].t, colSet, chk: chk.length > 0, pol, seed, trg: trg.length > 0 };
}

(async () => {
  await client.connect();
  out('# T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS — DB-gate evidence');
  out('');
  out(`- prod: rxlomoozakkjesdqjtvd`);
  out(`- 실행: ${new Date().toISOString()}`);
  out(`- 출처: supervisor FIX-REQUEST MSG-20260611-081226-7voz (phase1 db_gate_apply_required)`);
  out('');

  out('## [1] 사전 probe (재적용 전 — HALF-APPLIED 확인)');
  const before = await probe();
  out('```');
  out(`reservation_registrars EXISTS : ${before.tbl}`);
  out(`reservations.visit_route      : ${before.colSet.has('visit_route')}`);
  out(`reservations.registrar_id     : ${before.colSet.has('registrar_id')}`);
  out(`reservations.registrar_name   : ${before.colSet.has('registrar_name')}`);
  out(`visit_route CHECK constraint  : ${before.chk}`);
  out(`RLS policies                  : ${before.pol.map((p) => p.policyname).join(', ') || '(none)'}`);
  out(`updated_at trigger            : ${before.trg}`);
  out(`seed rows                     : ${before.seed.map((s) => `${s.group_name}=${s.n}`).join(', ') || '(none)'}`);
  out('```');
  out('');

  out('## [2] 마이그레이션 idempotent 재적용');
  out('파일: supabase/migrations/20260610110000_resv_registrar_route_fields.sql');
  out('(ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / seed NOT EXISTS 가드 — 재실행 안전)');
  // 마이그 파일은 자체 BEGIN/COMMIT 포함. CREATE POLICY 는 IF NOT EXISTS 미지원 →
  // 이미 정책 존재 시 42710 에러 발생 가능. 멱등 보장 위해 정책 4종 선제 DROP.
  await client.query(`
    DROP POLICY IF EXISTS "resv_registrars_select" ON public.reservation_registrars;
    DROP POLICY IF EXISTS "resv_registrars_insert" ON public.reservation_registrars;
    DROP POLICY IF EXISTS "resv_registrars_update" ON public.reservation_registrars;
    DROP POLICY IF EXISTS "resv_registrars_delete" ON public.reservation_registrars;
  `).catch((e) => {
    // 테이블 자체가 없으면 무시 (CREATE TABLE 이 곧 만든다)
    out(`  (선제 정책 DROP skip: ${e.message.split('\n')[0]})`);
  });
  await client.query(MIG_SQL);
  out('✅ 적용 완료 (에러 없음)');
  out('');

  out('## [3] 사후 probe (verify — supervisor 요구 항목)');
  const after = await probe();
  const checks = [
    ['reservation_registrars EXISTS', after.tbl],
    ['reservations.visit_route EXISTS', after.colSet.has('visit_route')],
    ['reservations.registrar_id EXISTS', after.colSet.has('registrar_id')],
    ['reservations.registrar_name EXISTS', after.colSet.has('registrar_name')],
    ['visit_route CHECK constraint', after.chk],
    ['updated_at trigger', after.trg],
    ['RLS policies (4종)', after.pol.length === 4],
  ];
  out('```');
  for (const [k, v] of checks) out(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  out(`RLS policy list: ${after.pol.map((p) => p.policyname).join(', ')}`);
  out('```');
  out('');

  out('## [4] seed rows (원내4 / TM4) — clinic별');
  const { rows: seedDetail } = await client.query(
    `SELECT c.name AS clinic, rr.group_name, count(*)::int AS n
       FROM public.reservation_registrars rr
       JOIN public.clinics c ON c.id = rr.clinic_id
      GROUP BY c.name, rr.group_name
      ORDER BY c.name, rr.group_name`,
  );
  out('```');
  for (const r of seedDetail) out(`${r.clinic} | ${r.group_name} | ${r.n}`);
  out('```');
  const { rows: names } = await client.query(
    `SELECT group_name, name, sort_order FROM public.reservation_registrars
      ORDER BY clinic_id, sort_order LIMIT 16`,
  );
  out('명단 샘플:');
  out('```');
  for (const r of names) out(`  ${r.sort_order}. [${r.group_name}] ${r.name}`);
  out('```');
  out('');

  const allPass = checks.every(([, v]) => v)
    && after.seed.some((s) => s.group_name === '원내' && s.n >= 4)
    && after.seed.some((s) => s.group_name === 'TM' && s.n >= 4);

  out(`## [결과] db_gate_status = ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  out('');
  out('- additive only, 기존 데이터 무손실. rollback: 20260610110000_resv_registrar_route_fields.rollback.sql');

  await client.end();

  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n', 'utf8');
  console.log(`\n📄 evidence → ${EVID_FILE}`);
  process.exit(allPass ? 0 : 2);
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
