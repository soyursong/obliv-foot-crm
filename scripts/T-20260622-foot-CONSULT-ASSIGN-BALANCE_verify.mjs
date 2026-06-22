/**
 * AC-5 (db_only) — assign_consultant_atomic 쏠림 버그픽스 시나리오 검증
 *
 * 시나리오: 상담사 A = 당일 완료(done) 5건 + 진행중 0  /  상담사 B = 진행중(consultation) 1건
 *   AS-IS(진행중-only):  A=0, B=1 → MIN=A → A 오선택(이미 5건 끝낸 A에 또 배정)
 *   TO-BE(<>cancelled):  A=5, B=1 → MIN=B → B 정선택
 *
 * 실 함수를 ROLLBACK 트랜잭션 안에서 합성 데이터로 호출(운영 데이터 무변경).
 *   적용 전 실행 → A 기대 / 적용 후 실행 → B 기대.
 *   `--expect A` 또는 `--expect B` 로 통과 기준 지정(미지정 시 결과만 출력).
 */
import pg from 'pg';

const expectIdx = process.argv.indexOf('--expect');
const EXPECT = expectIdx >= 0 ? process.argv[expectIdx + 1] : null; // 'A' | 'B' | null

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🧪 AC-5 시나리오 검증 (ROLLBACK tx, 운영 무변경)');
let outcome = null;
try {
  await client.connect();
  await client.query('BEGIN');

  // 1) 합성 clinic
  const { rows: cr } = await client.query(
    `INSERT INTO clinics (name, slug) VALUES ('TEST_BALANCE', 'test-balance-' || gen_random_uuid()) RETURNING id`,
  );
  const clinic = cr[0].id;

  // 2) 합성 상담사 A, B
  const { rows: sa } = await client.query(
    `INSERT INTO staff (clinic_id, name, role) VALUES ($1,'상담사A','consultant') RETURNING id`, [clinic]);
  const { rows: sb } = await client.query(
    `INSERT INTO staff (clinic_id, name, role) VALUES ($1,'상담사B','consultant') RETURNING id`, [clinic]);
  const A = sa[0].id, B = sb[0].id;

  // 3) 오늘(KST) 상담실 배정 2개
  await client.query(
    `INSERT INTO room_assignments (clinic_id, date, room_name, room_type, staff_id, staff_name)
     VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, '상담1','consultation',$2,'상담사A'),
            ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, '상담2','consultation',$3,'상담사B')`,
    [clinic, A, B]);

  // 4) A: 완료(done) 5건  (당일, KST)
  await client.query(
    `INSERT INTO check_ins (clinic_id, customer_name, status, consultant_id, checked_in_at)
     SELECT $1, 'A완료'||g, 'done', $2, now() FROM generate_series(1,5) g`, [clinic, A]);

  // 5) B: 진행중(consultation) 1건
  await client.query(
    `INSERT INTO check_ins (clinic_id, customer_name, status, consultant_id, checked_in_at)
     VALUES ($1, 'B진행', 'consultation', $2, now())`, [clinic, B]);

  // 6) 실제 함수 호출
  const { rows: rr } = await client.query(
    `SELECT assign_consultant_atomic($1, (now() AT TIME ZONE 'Asia/Seoul')::date::text) AS picked`, [clinic]);
  const picked = rr[0].picked;
  outcome = picked === A ? 'A' : picked === B ? 'B' : `unknown(${picked})`;

  // 부하 카운트 진단(양 필터)
  const { rows: diag } = await client.query(
    `SELECT s.name,
       (SELECT count(*) FROM check_ins ci WHERE ci.consultant_id=s.id AND ci.status IN ('consult_waiting','consultation')) AS inprogress_cnt,
       (SELECT count(*) FROM check_ins ci WHERE ci.consultant_id=s.id AND ci.status <> 'cancelled') AS cumulative_cnt
     FROM staff s WHERE s.clinic_id=$1 ORDER BY s.name`, [clinic]);
  console.log('  부하 진단:');
  diag.forEach(d => console.log(`    ${d.name}: 진행중=${d.inprogress_cnt}  당일누적(취소제외)=${d.cumulative_cnt}`));
  console.log(`  ▶ 선택된 상담사 = ${outcome}  (A=완료5/진행0, B=진행1)`);

  await client.query('ROLLBACK');
  console.log('  ↩ ROLLBACK (합성 데이터 폐기)');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

if (EXPECT) {
  const pass = outcome === EXPECT;
  console.log(`${pass ? '✅' : '❌'} 기대=${EXPECT} 실제=${outcome} → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
}
console.log('🏁 완료');
