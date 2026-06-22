/**
 * T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — room-exit 전이 과거 coverage 실측 (read-only)
 *
 * 목적: DA CONSULT-REPLY(MSG-20260623-024824-hhog) PART2 조건2(시계열 단절 정책) 분기 드라이버 측정.
 *   신규 측정창 종료점 = from_status='preconditioning'(치료실 퇴실 전이) = **status 전이값 기반**(room_id 비의존).
 *   → DA 우려(foot room_id 0% → backfill 불가)는 본 정의에 해당 없음. 실측으로 증명.
 *
 * 측정:
 *   1. 신규 종료이벤트 from_status='preconditioning' 월별 coverage (transitioned_at 기준)
 *   2. 구 종료이벤트 to_status='laser' 월별 coverage (비교)
 *   3. check_in 단위 windowable rate: 치료실 진입(to_status='preconditioning') 있는 체크인 중
 *      - 구 정의(to_status='laser' 종료)로 측정 가능 비율
 *      - 신 정의(from_status='preconditioning' 종료)로 측정 가능 비율
 *   4. 숫자 이동 규모: linked treatment_count 구 vs 신 (전체 기간)
 *   5. room_id 비의존 확인 (신규 정의가 room_id를 참조하지 않음을 명시)
 *
 * read-only. 쓰기 없음.
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
console.log('✅ DB 연결 (rxlomoozakkjesdqjtvd, read-only coverage probe)\n');

// ── 0) status_transitions 컬럼·room_id 의존성 확인 ──────────────────────────
const cols = await c.query(`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_name='status_transitions' AND column_name IN ('from_status','to_status','room_id','transitioned_at','check_in_id')
  ORDER BY column_name`);
console.log('── 0) status_transitions 스키마 ──');
console.table(cols.rows);
const hasRoomId = cols.rows.some(r => r.column_name === 'room_id');
if (hasRoomId) {
  const rid = await c.query(`SELECT COUNT(*) total, COUNT(room_id) filled, ROUND(100.0*COUNT(room_id)/NULLIF(COUNT(*),0),1) pct FROM status_transitions`);
  console.log('   status_transitions.room_id 채움률:', JSON.stringify(rid.rows[0]));
}
console.log('   ▶ 신규 측정창 종료점 = from_status=\'preconditioning\' (status 전이값 기반, room_id 비참조) → backfill 가능 후보\n');

// ── 1) 신규 종료이벤트 from_status='preconditioning' 월별 coverage ──────────
const newEvt = await c.query(`
  SELECT to_char(date_trunc('month', transitioned_at AT TIME ZONE 'Asia/Seoul'),'YYYY-MM') ym,
         COUNT(*) cnt
  FROM status_transitions
  WHERE from_status='preconditioning'
  GROUP BY 1 ORDER BY 1`);
console.log('── 1) 신규 종료이벤트 from_status=\'preconditioning\' 월별 적재 ──');
console.table(newEvt.rows);

// ── 2) 구 종료이벤트 to_status='laser' 월별 coverage (비교) ──────────────────
const oldEvt = await c.query(`
  SELECT to_char(date_trunc('month', transitioned_at AT TIME ZONE 'Asia/Seoul'),'YYYY-MM') ym,
         COUNT(*) cnt
  FROM status_transitions
  WHERE to_status='laser'
  GROUP BY 1 ORDER BY 1`);
console.log('── 2) 구 종료이벤트 to_status=\'laser\' 월별 적재 (비교) ──');
console.table(oldEvt.rows);

// ── 3) check_in 단위 windowable rate ────────────────────────────────────────
const winRate = await c.query(`
  WITH starts AS (
    SELECT DISTINCT check_in_id FROM status_transitions WHERE to_status='preconditioning'
  ),
  ends_old AS (
    SELECT DISTINCT check_in_id FROM status_transitions WHERE to_status='laser'
  ),
  ends_new AS (
    SELECT DISTINCT check_in_id FROM status_transitions WHERE from_status='preconditioning'
  )
  SELECT
    (SELECT COUNT(*) FROM starts) AS checkins_with_room_entry,
    (SELECT COUNT(*) FROM starts s WHERE EXISTS (SELECT 1 FROM ends_old e WHERE e.check_in_id=s.check_in_id)) AS measurable_old_laser_end,
    (SELECT COUNT(*) FROM starts s WHERE EXISTS (SELECT 1 FROM ends_new e WHERE e.check_in_id=s.check_in_id)) AS measurable_new_roomexit_end`);
console.log('── 3) check_in 단위 windowable (치료실 진입 보유 체크인 중 종료 측정 가능 수) ──');
const w = winRate.rows[0];
const base = Number(w.checkins_with_room_entry) || 0;
console.log(`   치료실진입(to_status=preconditioning) 보유 체크인: ${w.checkins_with_room_entry}`);
console.log(`   └ 구 정의(laser 종료) 측정가능: ${w.measurable_old_laser_end} (${base?((100*w.measurable_old_laser_end/base).toFixed(1)):'-'}%)`);
console.log(`   └ 신 정의(치료실퇴실 종료) 측정가능: ${w.measurable_new_roomexit_end} (${base?((100*w.measurable_new_roomexit_end/base).toFixed(1)):'-'}%)\n`);

// ── 4) 숫자 이동 규모: linked treatment_count 구 vs 신 (전체기간, 전 클리닉) ──
//    summary RPC 와 동일한 lineage(check_in × package_session 동일 고객·치료사·날짜 매칭)로 측정.
const delta = await c.query(`
  WITH base AS (
    SELECT ci.id, ci.therapist_id, ci.customer_id,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM check_ins ci
    WHERE ci.therapist_id IS NOT NULL AND ci.status <> 'cancelled'
  ),
  win AS (
    SELECT b.id, b.therapist_id, b.customer_id, b.kst_date,
      MIN(st.transitioned_at) FILTER (WHERE st.to_status='preconditioning')   AS start_at,
      MIN(st.transitioned_at) FILTER (WHERE st.to_status='laser')             AS end_old,
      MIN(st.transitioned_at) FILTER (WHERE st.from_status='preconditioning') AS end_new
    FROM base b JOIN status_transitions st ON st.check_in_id=b.id
    GROUP BY b.id, b.therapist_id, b.customer_id, b.kst_date
  ),
  b_events AS (
    SELECT ps.performed_by AS therapist_id, c.id AS customer_id, ps.session_date AS kst_date
    FROM package_sessions ps
    JOIN packages pk ON pk.id=ps.package_id
    JOIN customers c ON c.id=pk.customer_id
    WHERE ps.status='used' AND ps.performed_by IS NOT NULL
      AND ps.session_type IN ('unheated_laser','preconditioning','heated_laser','podologue','reborn')
  ),
  linked AS (
    SELECT w.*,
      EXTRACT(EPOCH FROM (w.end_old - w.start_at))/60.0 AS min_old,
      EXTRACT(EPOCH FROM (w.end_new - w.start_at))/60.0 AS min_new
    FROM win w
    WHERE EXISTS (SELECT 1 FROM b_events b WHERE b.customer_id=w.customer_id AND b.therapist_id=w.therapist_id AND b.kst_date=w.kst_date)
  )
  SELECT
    COUNT(*) FILTER (WHERE start_at IS NOT NULL AND end_old IS NOT NULL AND end_old>start_at AND min_old>0) AS tcount_old,
    ROUND(AVG(min_old) FILTER (WHERE start_at IS NOT NULL AND end_old IS NOT NULL AND end_old>start_at AND min_old>0),1) AS avg_old,
    COUNT(*) FILTER (WHERE start_at IS NOT NULL AND end_new IS NOT NULL AND end_new>start_at AND min_new>0) AS tcount_new,
    ROUND(AVG(min_new) FILTER (WHERE start_at IS NOT NULL AND end_new IS NOT NULL AND end_new>start_at AND min_new>0),1) AS avg_new
  FROM linked`);
console.log('── 4) 숫자 이동 규모 (전체기간·전클리닉, summary lineage) ──');
const d = delta.rows[0];
console.log(`   구 정의(laser 종료):     treatment_count=${d.tcount_old}, avg_treatment_minutes=${d.avg_old}`);
console.log(`   신 정의(치료실퇴실 종료): treatment_count=${d.tcount_new}, avg_treatment_minutes=${d.avg_new}`);
const dc = Number(d.tcount_new)-Number(d.tcount_old);
console.log(`   Δ treatment_count = ${dc>=0?'+':''}${dc} (신규 정의로 ${dc>=0?'추가 포착':'감소'})\n`);

// ── 5) 데이터 시작점 (전체 transitions 최초 시각) ─────────────────────────────
const span = await c.query(`SELECT MIN(transitioned_at) min_ts, MAX(transitioned_at) max_ts, COUNT(*) total FROM status_transitions`);
console.log('── 5) status_transitions 데이터 범위 ──');
console.log('  ', JSON.stringify(span.rows[0]));

console.log('\n=== coverage probe 완료 (read-only, 쓰기 0건) ===');
await c.end();
