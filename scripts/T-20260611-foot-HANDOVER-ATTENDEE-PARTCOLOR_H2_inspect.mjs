/**
 * T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR — H2 INSERT 사전 진단 (READ-ONLY)
 *
 * 목적: prod staff 코디 4인 INSERT 전 사전조사.
 *   1) foot(jongno-foot) clinic id
 *   2) staff 테이블 NOT NULL 컬럼 전수 (INSERT 누락 방지)
 *   3) 기존 coordinator '데스크' placeholder 행 = 템플릿
 *   4) 김민경/김지혜/박민석/장예지 기존 존재 여부 (중복 INSERT 방지)
 *
 * SELECT only. write 금지.
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
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const TARGET = ['김민경', '김지혜', '박민석', '장예지'];

async function main() {
  await client.connect();

  // 1) foot clinic
  const clinics = await client.query(
    `SELECT id, name, slug FROM clinics WHERE slug ILIKE '%foot%' OR slug='jongno-foot'`
  );
  console.log('=== foot clinic 후보 ===');
  console.table(clinics.rows);

  // 2) staff NOT NULL 컬럼 + 디폴트
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff'
      ORDER BY ordinal_position`
  );
  console.log('\n=== staff 컬럼 (is_nullable=NO 주목) ===');
  console.table(cols.rows);

  for (const c of clinics.rows) {
    console.log(`\n############ clinic ${c.slug} id=${c.id} ############`);

    // 3) coordinator 템플릿 행 전체
    const coord = await client.query(
      `SELECT * FROM staff WHERE clinic_id=$1 AND role='coordinator' ORDER BY created_at`,
      [c.id]
    );
    console.log(`--- 기존 coordinator 행 (${coord.rowCount}) ---`);
    console.dir(coord.rows, { depth: null });

    // 4) 대상 4인 기존 존재?
    const exist = await client.query(
      `SELECT id, name, role, active FROM staff
        WHERE clinic_id=$1 AND replace(name,' ','') = ANY($2::text[])`,
      [c.id, TARGET]
    );
    console.log(`--- 대상 4인 기존 매칭 (${exist.rowCount}) ---`);
    console.table(exist.rows);
  }

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
