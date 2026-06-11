/**
 * T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK Phase 2 진단 (READ-ONLY)
 * 비활성 레이저실 L2(김민준) / L7(셀프접수테스트)에 끼어 있는 환자 식별.
 * ⚠️ SELECT only — 어떤 변경도 하지 않음. 식별 확정 후 별도 _revert.mjs에서 UPDATE.
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

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const today = process.argv[2] || new Date().toISOString().slice(0, 10);

try {
  await client.connect();
  console.log(`🔎 진단 기준일: ${today}\n`);

  // 0) check_ins 컬럼 확인
  const cols = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='check_ins' AND column_name IN
      ('id','customer_id','status','laser_room','treatment_room','consultation_room','examination_room','clinic_id','created_at','checked_in_at','date')
    ORDER BY column_name;`);
  console.log('check_ins 관련 컬럼:', cols.rows.map(r => r.column_name).join(', '), '\n');

  // 날짜 컬럼 결정 (date 우선, 없으면 created_at::date)
  const hasDate = cols.rows.some(r => r.column_name === 'date');
  const dateExpr = hasDate ? 'ci.date' : '(ci.created_at AT TIME ZONE \'Asia/Seoul\')::date';

  // 1) 오늘 레이저실 점유 현황 (L2/L7 중심, 전체 레이저 배정도 함께)
  const occ = await client.query(`
    SELECT ci.id, ci.status, ci.laser_room, ci.treatment_room, ci.consultation_room,
           c.name AS customer_name, c.phone, ci.clinic_id, ci.created_at
    FROM check_ins ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ${dateExpr} = $1
      AND (ci.laser_room IS NOT NULL OR c.name IN ('김민준','셀프접수테스트'))
    ORDER BY ci.laser_room NULLS LAST, ci.created_at;`, [today]);
  console.log(`▶ 오늘 레이저 배정/대상 후보 ${occ.rowCount}건:`);
  for (const r of occ.rows) {
    console.log(`  - [${r.laser_room ?? '-'}] ${r.customer_name ?? '(이름없음)'} | status=${r.status} | id=${r.id} | tx_room=${r.treatment_room ?? '-'} | created=${r.created_at?.toISOString?.() ?? r.created_at}`);
  }
  console.log('');

  // 2) 비활성 방 현황 (daily_room_status is_active=false, 오늘+carry_over)
  const inact = await client.query(`
    SELECT room_name, is_active, carry_over, date, clinic_id
    FROM daily_room_status
    WHERE is_active = false AND (date = $1 OR carry_over = true)
    ORDER BY room_name;`, [today]);
  console.log(`▶ 비활성 방(is_active=false) ${inact.rowCount}건:`);
  for (const r of inact.rows) {
    console.log(`  - ${r.room_name} | carry_over=${r.carry_over} | date=${r.date}`);
  }
  console.log('');

  // 3) 김민준 / 셀프접수테스트 동명이인 수 점검
  const dup = await client.query(`
    SELECT c.name, count(*) AS cnt
    FROM check_ins ci JOIN customers c ON c.id=ci.customer_id
    WHERE ${dateExpr} = $1 AND c.name IN ('김민준','셀프접수테스트')
    GROUP BY c.name;`, [today]);
  console.log('▶ 동명이인/대상 건수(오늘):');
  for (const r of dup.rows) console.log(`  - ${r.name}: ${r.cnt}건`);

} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
