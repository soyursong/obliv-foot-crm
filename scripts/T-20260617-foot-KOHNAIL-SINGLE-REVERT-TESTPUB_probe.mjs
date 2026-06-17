/**
 * T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB — AC-3 사전 probe (READ-ONLY)
 *
 * 목적: 더미 발행 동선 실증 전, (a) check_ins/check_in_services 스키마 컬럼,
 *       (b) 현재 6월 KOH 발행대상 후보(어제↓ 검사 + nail_sites 있고 미발행) 유무 확인.
 * prod 쓰기 0 (SELECT only).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const DB_PASSWORD = (env.match(/^SUPABASE_DB_PASSWORD=(.*)$/m) || [])[1].trim();

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const q = async (label, sql, params = []) => {
  try { const { rows } = await client.query(sql, params); console.log(`\n=== ${label} ===`); console.dir(rows, { depth: 4 }); return rows; }
  catch (e) { console.log(`\n=== ${label} ===\n  ❌ ${e.message}`); return null; }
};

(async () => {
  await client.connect();
  console.log('connected (read-only)');

  await q('check_ins columns', `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='check_ins' ORDER BY ordinal_position`);
  await q('check_in_services columns', `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='check_in_services' ORDER BY ordinal_position`);

  // 현재 6월 KOH 행 (clinic, KOH/진균검사) — 발행대상 후보 판정
  await q('June KOH services (clinic, this month)',
    `SELECT cis.id, cis.service_name, cis.created_at, cis.koh_requested,
            jsonb_array_length(COALESCE(cis.koh_nail_sites,'[]'::jsonb)) AS n_sites,
            (cis.created_at AT TIME ZONE 'Asia/Seoul')::date AS exam_date_kst,
            ci.customer_name
       FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
      WHERE ci.clinic_id = $1
        AND (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
        AND cis.created_at >= '2026-06-01T00:00:00+09:00'
      ORDER BY cis.created_at DESC LIMIT 30`, [CLINIC]);

  // 기 발행 결과지 (koh_service_id 매핑)
  await q('published koh_result (field_data.koh_service_id)',
    `SELECT fs.id, fs.status, fs.field_data->>'koh_service_id' AS koh_service_id, fs.field_data->>'request_no' AS request_no, fs.created_at
       FROM form_submissions fs JOIN form_templates ft ON ft.id = fs.template_id
      WHERE ft.form_key='koh_result' AND fs.clinic_id=$1 ORDER BY fs.created_at DESC LIMIT 10`, [CLINIC]);

  await client.end();
  console.log('\ndone.');
})();
