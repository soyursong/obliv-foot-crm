/**
 * T-20260617-foot-CHECKIN-CHART-LINK-3KEY — AC-6 김사비 차트복구 운영 적용
 *
 * supervisor DB-게이트 GO (2026-06-17 17:12) 후 운영 적용.
 * 적용 SQL: memory/scripts/T-20260617-foot-CHECKIN-CHART-LINK-3KEY_datafix.sql
 *   check_in 4b091fa7 의 customer_id 8ba2bbef(문자테스트/F-1189, 오배정)
 *     → 2be865ff(김사비/F-0087) 로 환원. 단일 UPDATE 1행, guard 멱등.
 * rollback: memory/scripts/..._datafix.rollback.sql
 *
 * 안전 구조: BEGIN → 사전상태 캡처 → UPDATE → 인-트랜잭션 검증
 *   (ROWS=1, linked=김사비/F-0087, clinic 보존) → 통과 시 COMMIT, 실패 시 ROLLBACK.
 * 실행: node scripts/T-20260617-foot-CHECKIN-CHART-LINK-3KEY_apply.mjs
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const CHECKIN_ID = '4b091fa7-29c9-48c8-854b-42b53905351b';
const KIMSABI = '2be865ff-6a9d-4666-892c-1cfd2d971199'; // 김사비 / F-0087 (정답)
const MUNJA = '8ba2bbef-018e-4207-b2ab-196e18322437';   // 문자테스트 / F-1189 (오배정)

const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260617-foot-CHECKIN-CHART-LINK-3KEY_apply_evidence.md');

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
let failed = false;
const assert = (cond, label) => {
  out(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failed = true;
};

(async () => {
  await client.connect();
  out('# T-20260617-foot-CHECKIN-CHART-LINK-3KEY — AC-6 김사비 차트복구 운영 적용');
  out(`# at: ${new Date().toISOString()}`);
  out('');

  // ── 사전 상태 (read-only, 트랜잭션 밖) ──
  const before = await client.query(
    `SELECT ci.id, ci.customer_id, ci.customer_name, ci.clinic_id, ci.status,
            c.name AS linked_name, c.chart_number AS linked_chart
       FROM check_ins ci LEFT JOIN customers c ON c.id = ci.customer_id
      WHERE ci.id = $1`, [CHECKIN_ID]);
  out('## BEFORE');
  out('```');
  out(JSON.stringify(before.rows[0], null, 2));
  out('```');
  const b = before.rows[0];
  const clinicBefore = b?.clinic_id ?? null;

  if (!b) { out('✗ check_in not found — abort'); await client.end(); process.exit(1); }

  // 멱등: 이미 김사비로 연결돼 있으면 적용 불요
  if (b.customer_id === KIMSABI) {
    out('\n→ 이미 김사비(F-0087)로 연결됨. 멱등 — 변경 불요.');
    assert(b.linked_chart === 'F-0087', `linked_chart=F-0087 (actual=${b.linked_chart})`);
    finalize(true);
    return;
  }

  // ── 트랜잭션: UPDATE → 검증 → COMMIT/ROLLBACK ──
  await client.query('BEGIN');
  const upd = await client.query(
    `UPDATE check_ins
        SET customer_id = $1
      WHERE id = $2 AND customer_id = $3 AND trim(customer_name) = '김사비'`,
    [KIMSABI, CHECKIN_ID, MUNJA]);
  out(`\n## UPDATE rows affected = ${upd.rowCount}`);
  assert(upd.rowCount === 1, `ROWS AFFECTED = 1 (actual=${upd.rowCount})`);

  const after = await client.query(
    `SELECT ci.id, ci.customer_id, ci.customer_name, ci.clinic_id, ci.status,
            c.name AS linked_name, c.chart_number AS linked_chart
       FROM check_ins ci LEFT JOIN customers c ON c.id = ci.customer_id
      WHERE ci.id = $1`, [CHECKIN_ID]);
  const a = after.rows[0];
  out('## AFTER (in-tx)');
  out('```');
  out(JSON.stringify(a, null, 2));
  out('```');

  assert(a.customer_id === KIMSABI, 'linked customer_id = 김사비(2be865ff)');
  assert(a.linked_name === '김사비', `linked_name = 김사비 (actual=${a.linked_name})`);
  assert(a.linked_chart === 'F-0087', `linked_chart = F-0087 (actual=${a.linked_chart})`);
  assert(a.clinic_id === clinicBefore, `clinic 보존 (${clinicBefore} → ${a.clinic_id})`);

  if (failed) {
    await client.query('ROLLBACK');
    out('\n✗✗ 검증 실패 → ROLLBACK 완료. prod 무변경. planner 보고 필요.');
  } else {
    await client.query('COMMIT');
    out('\n✓✓ 검증 통과 → COMMIT 완료. 김사비 차트(F-0087) 정상 연결.');
  }
  finalize(!failed);
})().catch(async (e) => {
  try { await client.query('ROLLBACK'); } catch {}
  out(`\n✗ ERROR: ${e.message} → ROLLBACK 시도`);
  finalize(false);
});

function finalize(ok) {
  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n');
  out(`\n# evidence → ${EVID_FILE}`);
  client.end().finally(() => process.exit(ok ? 0 : 1));
}
