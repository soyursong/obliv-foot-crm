/**
 * T-20260519-foot-PENCHART-FORMS
 * form_templates 시드: personal_checklist_general / personal_checklist_senior 2종
 * 멱등: ON CONFLICT DO UPDATE — 재실행 안전
 */
import pkg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pkg;

const DB_URL = 'postgresql://postgres:bQpgC6tYfXhp%40Hr@db.rxlomoozakkjesdqjtvd.supabase.co:5432/postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, '../supabase/migrations/20260519000050_personal_checklist_templates.sql'),
  'utf-8'
);

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  await client.query(sql);
  console.log('✅ 마이그레이션 적용 완료: 20260519000050_personal_checklist_templates');

  // 확인 쿼리
  const { rows } = await client.query(`
    SELECT form_key, name_ko, sort_order, template_format, active
    FROM form_templates
    WHERE form_key IN ('personal_checklist_general', 'personal_checklist_senior')
      AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
    ORDER BY sort_order
  `);
  console.log('📋 등록된 템플릿:');
  rows.forEach(r => {
    console.log(`  - ${r.form_key}: ${r.name_ko} (sort=${r.sort_order}, format=${r.template_format}, active=${r.active})`);
  });

  if (rows.length !== 2) {
    console.error('❌ 예상 2행, 실제:', rows.length);
    process.exit(1);
  }
  console.log('✅ 검증 완료 — 2종 템플릿 등록 확인');

} catch (err) {
  console.error('❌ 실패:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
