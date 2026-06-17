/**
 * T-20260617-scalp-SOLAPI-SEND-TEST-NUMBER-AUDIT (B-CROSS) — 풋 CRM 발신번호 실측 (READ-ONLY)
 *
 * 목적: 종로점 발신번호 01088277791(풋) ↔ 01058103277(scalp 종로) 교차 중복 확인.
 * 풋 clinic_messaging_capability 전체 행을 clinics 조인으로 덤프.
 * 주의: SELECT 전용. 삭제/수정/배포 없음.
 *
 * 실행: node scripts/diag_sender_number_audit_20260617.mjs
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function q(label, sql, params = []) {
  const r = await client.query(sql, params);
  console.log(`\n===== ${label} (${r.rowCount} rows) =====`);
  console.table(r.rows);
  return r.rows;
}

(async () => {
  await client.connect();
  // 0) 실제 컬럼 확인 (branch / validation_status 존재 여부)
  await q('clinic_messaging_capability columns',
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='clinic_messaging_capability'
     ORDER BY ordinal_position`);

  // 1) 전체 행 덤프 (clinics 조인)
  await q('ALL messaging capability rows',
    `SELECT c.slug AS clinic_slug, c.name AS clinic_name,
            cap.sender_number, cap.enabled,
            cap.send_start_hour, cap.send_end_hour, cap.updated_at
     FROM public.clinic_messaging_capability cap
     JOIN public.clinics c ON c.id = cap.clinic_id
     ORDER BY c.slug`);

  // 2) 의심 번호 매칭
  await q('sender_number = 01088277791 or 01058103277',
    `SELECT c.slug AS clinic_slug, c.name AS clinic_name, cap.sender_number, cap.enabled
     FROM public.clinic_messaging_capability cap
     JOIN public.clinics c ON c.id = cap.clinic_id
     WHERE replace(cap.sender_number,'-','') IN ('01088277791','01058103277')`);

  // 3) 전체 clinics에 등록된 phone 도 참고 (혹시 발신번호가 clinics.phone에 박혀있나)
  await q('clinics.phone reference',
    `SELECT slug, name, phone FROM public.clinics ORDER BY slug`);

  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
