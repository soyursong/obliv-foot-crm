/**
 * T-20260615-foot-RESVMGMT-REFIX-8 AC7 — registrar_name null 비율 자가검증 (read-only)
 * planner FIX-REQUEST MSG-20260615-134257-58f6 지시:
 *   RESV-REGISTRAR-ROUTE-FIELDS 배포(2026-06-11 KST) 이전/이후 생성 예약의 registrar_name null 비율 비교.
 *   (a) 이후분 채워지고 이전분만 null → 정상(backfill 공백). FE 정상.
 *   (b) 이후분도 광범위 null → write 경로 회귀. → reopen.
 * 추가 진단: createReservationCanonical(생성 단일소스)에 registrar 필드 부재 확인 보강 —
 *   registrar_id NOT NULL & registrar_name NULL (route-save 스냅샷 누락 = 진짜 write 버그 시그니처) 카운트.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결 (read-only)\n');

const CUTOFF = "2026-06-11 00:00:00+09"; // RESV-REGISTRAR-ROUTE-FIELDS 배포 (KST)

// [1] 배포 이전/이후 생성분 registrar_name null 비율
const periods = await c.query(`
  SELECT
    CASE WHEN created_at >= TIMESTAMPTZ '${CUTOFF}' THEN 'AFTER (>=2026-06-11)' ELSE 'BEFORE (<2026-06-11)' END AS period,
    COUNT(*)                                            AS total,
    COUNT(registrar_name)                               AS name_filled,
    COUNT(*) - COUNT(registrar_name)                    AS name_null,
    ROUND(100.0 * (COUNT(*) - COUNT(registrar_name)) / NULLIF(COUNT(*),0), 1) AS null_pct
  FROM reservations
  GROUP BY 1 ORDER BY 1`);
console.log('[1] 배포 이전/이후 생성분 registrar_name null 비율');
console.table(periods.rows);

// [2] 최근 14일 일자별(생성일 KST) null 비율 — 추세 확인
const daily = await c.query(`
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS create_day,
         COUNT(*) AS total, COUNT(registrar_name) AS name_filled,
         ROUND(100.0 * (COUNT(*) - COUNT(registrar_name)) / NULLIF(COUNT(*),0), 1) AS null_pct
  FROM reservations
  WHERE created_at >= now() - interval '14 days'
  GROUP BY 1 ORDER BY 1`);
console.log('\n[2] 최근 14일 일자별 registrar_name null 비율(생성일 KST)');
console.table(daily.rows);

// [3] write 버그 시그니처: registrar_id 있는데 registrar_name 없는 행 (route-save 스냅샷 누락)
const orphan = await c.query(`
  SELECT
    COUNT(*) FILTER (WHERE registrar_id IS NOT NULL)                          AS has_registrar_id,
    COUNT(*) FILTER (WHERE registrar_id IS NOT NULL AND registrar_name IS NULL) AS id_but_no_name,
    COUNT(*) FILTER (WHERE registrar_name IS NOT NULL)                         AS has_registrar_name
  FROM reservations`);
console.log('\n[3] write 버그 시그니처(registrar_id 有 & registrar_name 無 = 스냅샷 누락)');
console.table(orphan.rows);

// [4] 배포 이후분 중 registrar_id 부여된 예약은 name도 채워졌나 (write 경로 정상 입증)
const afterAssigned = await c.query(`
  SELECT COUNT(*) AS after_with_id,
         COUNT(registrar_name) AS after_with_id_and_name
  FROM reservations
  WHERE created_at >= TIMESTAMPTZ '${CUTOFF}' AND registrar_id IS NOT NULL`);
console.log('\n[4] 배포 이후 생성 & registrar_id 부여분의 name 채움 여부');
console.table(afterAssigned.rows);

console.log('\n=== 해석 가이드 ===');
console.log('· createReservationCanonical(생성 단일소스)는 registrar_id/name 미기록 → 신규예약은 기본 registrar_name=NULL.');
console.log('· registrar_name 은 기존 예약 대상 수동 route-save(예약등록자 선택)에서만 채워짐.');
console.log('· [3] id_but_no_name=0 이면 route-save write 경로 무결 → (a) 정상(미할당이 기본).');
console.log('· [4] after_with_id == after_with_id_and_name 이면 배포 이후 write 정상 입증.');
await c.end();
