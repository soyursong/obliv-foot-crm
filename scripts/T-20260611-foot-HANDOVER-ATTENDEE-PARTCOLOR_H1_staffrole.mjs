/**
 * T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR — H1 진단 (READ-ONLY, 직접 pg)
 *
 * 목적: 출근자 카드 상담실장 rose 미반영 근본원인 H1(staff.role 값 불일치) 검증.
 *   - foot clinic 활성 staff role 분포
 *   - 상담실장 후보 행(name/display_name/role) 전수
 *   - role이 표준 8종 밖인 행
 *
 * SELECT only. prod write 절대 금지.
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

const STD_ROLES = ['consultant','coordinator','therapist','director','part_lead','technician','tm','staff','admin','manager'];

async function main() {
  await client.connect();

  // foot clinic 식별 (slug)
  const clinics = await client.query(
    `SELECT id, name, slug FROM clinics WHERE slug ILIKE '%foot%' OR name ILIKE '%풋%' OR name ILIKE '%종로%'`
  );
  console.log('=== foot clinic 후보 ===');
  console.table(clinics.rows);

  for (const c of clinics.rows) {
    console.log(`\n############ clinic ${c.slug} (${c.name}) id=${c.id} ############`);

    // role 분포
    const dist = await client.query(
      `SELECT role, count(*)::int AS cnt FROM staff WHERE clinic_id=$1 AND active=true GROUP BY role ORDER BY role`,
      [c.id]
    );
    console.log('--- 활성 staff role 분포 ---');
    console.table(dist.rows);

    // 상담실장 후보 + 비표준 role
    const susp = await client.query(
      `SELECT name, role, active
         FROM staff
        WHERE clinic_id=$1 AND active=true
          AND (name LIKE '%상담%'
               OR role NOT IN (${STD_ROLES.map((_, i) => `$${i + 2}`).join(',')}))
        ORDER BY role, name`,
      [c.id, ...STD_ROLES]
    );
    console.log('--- 상담 키워드/비표준 role 후보 ---');
    console.table(susp.rows);

    // consultant 전수 (정상 매핑 대상)
    const cons = await client.query(
      `SELECT name, role FROM staff WHERE clinic_id=$1 AND active=true AND role='consultant' ORDER BY name`,
      [c.id]
    );
    console.log(`--- role='consultant' 활성 직원 (${cons.rowCount}명) ---`);
    console.table(cons.rows);
  }

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
