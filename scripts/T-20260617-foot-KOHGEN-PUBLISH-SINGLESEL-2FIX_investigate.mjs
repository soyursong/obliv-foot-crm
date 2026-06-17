/**
 * T-20260617-foot-KOHGEN-PUBLISH-SINGLESEL-2FIX — 이슈1 선조사 (READ-ONLY)
 *
 * 발행 버튼 동작 안 함 → 원인 A/B/C 확정용 prod probe.
 *   A. koh_result form_template seed 부재 (= LIFECYCLE-PUBLISH 마이그 prod 미적용)
 *   B. publish_koh_result / next_koh_request_no RPC 부재
 *   C. form_submissions.status CHECK 에 'published' 부재
 *
 * prod 쓰기 절대 금지 (SELECT only).
 * author: dev-foot / 2026-06-17
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const DB_PASSWORD = (env.match(/^SUPABASE_DB_PASSWORD=(.*)$/m) || [])[1].trim();
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const q = async (label, sql, params = []) => {
  try {
    const { rows } = await client.query(sql, params);
    console.log(`\n=== ${label} ===`);
    console.dir(rows, { depth: 4 });
    return rows;
  } catch (e) {
    console.log(`\n=== ${label} ===\n  ❌ ERROR: ${e.message}`);
    return null;
  }
};

(async () => {
  await client.connect();
  console.log('connected to prod (read-only probe)');

  // 원인 A: koh_result form_template seed
  await q('A. form_templates koh_result seed',
    `SELECT id, clinic_id, form_key, name_ko, template_format, active, sort_order
       FROM form_templates WHERE form_key = 'koh_result'`);

  // 원인 B: RPC 존재 여부
  await q('B. publish/seq RPCs',
    `SELECT proname FROM pg_proc
      WHERE proname IN ('publish_koh_result','next_koh_request_no','next_koh_specimen_no','set_koh_requested','set_koh_nail_sites')
      ORDER BY proname`);

  // 원인 C: form_submissions.status CHECK 에 published 포함 여부
  await q('C. form_submissions status CHECK',
    `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conname = 'form_submissions_status_check'`);

  // koh_requested 컬럼 (목록 노출 폴백과 관련)
  await q('D. check_in_services.koh_requested column',
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_name='check_in_services' AND column_name IN ('koh_requested','koh_nail_sites')`);

  // 기 발행 결과지 (있으면 발행은 동작 중)
  await q('E. published koh_result submissions count',
    `SELECT count(*) AS published_cnt
       FROM form_submissions fs JOIN form_templates ft ON ft.id = fs.template_id
      WHERE ft.form_key='koh_result' AND fs.status='published'`);

  // 이슈2 관련: 기 저장된 다중부위(2개+) 행 — 회귀 안전 확인용
  await q('F. multi-site koh_nail_sites rows (이슈2 회귀 baseline)',
    `SELECT id, jsonb_array_length(koh_nail_sites) AS n_sites, koh_nail_sites
       FROM check_in_services
      WHERE koh_nail_sites IS NOT NULL
        AND jsonb_typeof(koh_nail_sites)='array'
        AND jsonb_array_length(koh_nail_sites) >= 2
      LIMIT 10`);

  await client.end();
  console.log('\ndone.');
})();
