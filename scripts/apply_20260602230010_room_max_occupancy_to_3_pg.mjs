/**
 * T-20260602-foot-SLOT-CAPACITY-3 — 상담실/치료실 슬롯 최대 수용 3명
 *
 * dev-foot 직접 적용(_pg): pooler 직결(SUPABASE_DB_PASSWORD)로 마이그레이션 실행.
 * (정책: dev-foot DB 마이그레이션 직접 실행 / FIX-REQUEST re:MSG-20260603-145631)
 *
 * 사용:
 *   node scripts/apply_20260602230010_room_max_occupancy_to_3_pg.mjs            # dry-run(검증만)
 *   node scripts/apply_20260602230010_room_max_occupancy_to_3_pg.mjs --apply    # 적용(스냅샷+상향)
 *   node scripts/apply_20260602230010_room_max_occupancy_to_3_pg.mjs --rollback # 스냅샷 원복
 *
 * author: dev-foot / 2026-06-03
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 로드 (SUPABASE_DB_PASSWORD)
const envPath = join(__dirname, '../.env');
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
} catch { /* env optional */ }

if (!DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)');
  process.exit(1);
}

const ROLLBACK = process.argv.includes('--rollback');
const APPLY = process.argv.includes('--apply') || ROLLBACK;

const SQL_FILE = ROLLBACK
  ? '../supabase/migrations/20260602230010_room_max_occupancy_to_3.rollback.sql'
  : '../supabase/migrations/20260602230010_room_max_occupancy_to_3.sql';
const SQL = readFileSync(join(__dirname, SQL_FILE), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const mode = ROLLBACK ? '롤백' : APPLY ? '적용' : 'DRY-RUN(검증만)';
console.log(`🚀 rooms.max_occupancy → 3 (consultation/treatment) — ${mode}`);

// room_type 별 max_occupancy 분포 출력 헬퍼
async function snapshotDist(label) {
  const { rows } = await client.query(`
    SELECT room_type, max_occupancy, count(*)::int AS n
      FROM rooms
     GROUP BY room_type, max_occupancy
     ORDER BY room_type, max_occupancy;
  `);
  console.log(`📊 [${label}] room_type / max_occupancy / 개수`);
  for (const r of rows) console.log(`     ${r.room_type.padEnd(14)} occ=${r.max_occupancy}  x${r.n}`);
  return rows;
}

try {
  await client.connect();

  await snapshotDist('적용 전');

  if (!APPLY) {
    // dry-run: 상향 대상 건수만 추정
    const { rows: tgt } = await client.query(`
      SELECT count(*)::int AS will_update
        FROM rooms
       WHERE room_type IN ('consultation','treatment') AND max_occupancy < 3;
    `);
    console.log(`ℹ️ DRY-RUN — 상향 대상(consultation/treatment, occ<3): ${tgt[0].will_update} 건. 실제 변경 없음. 적용하려면 --apply`);
  } else {
    await client.query(SQL);
    await snapshotDist('적용 후');

    if (ROLLBACK) {
      // 롤백 검증: 스냅샷 테이블이 제거되었는지
      const { rows } = await client.query(`
        SELECT to_regclass('public._rollback_room_max_occ_20260602') IS NULL AS dropped;
      `);
      console.log(rows[0].dropped ? '✅ 롤백 확인: 스냅샷에서 원값 복원 + 스냅샷 테이블 제거됨' : '⚠️ 스냅샷 테이블 잔존 — 확인 필요');
    } else {
      // 적용 검증
      const { rows: bad } = await client.query(`
        SELECT count(*)::int AS not_three
          FROM rooms
         WHERE room_type IN ('consultation','treatment') AND max_occupancy < 3;
      `);
      const { rows: snap } = await client.query(`
        SELECT count(*)::int AS snap_rows FROM _rollback_room_max_occ_20260602;
      `);
      const { rows: untouched } = await client.query(`
        SELECT room_type, min(max_occupancy)::int AS min_occ, max(max_occupancy)::int AS max_occ
          FROM rooms
         WHERE room_type IN ('examination','laser')
         GROUP BY room_type ORDER BY room_type;
      `);
      console.log(`🔎 consultation/treatment occ<3 잔존: ${bad[0].not_three} (0 이어야 정상)`);
      console.log(`🔎 스냅샷 보존 행수: ${snap[0].snap_rows}`);
      for (const u of untouched) console.log(`🔎 미변경 확인 ${u.room_type}: occ ${u.min_occ}~${u.max_occ}`);
      if (bad[0].not_three > 0) throw new Error('적용 검증 실패: consultation/treatment 중 occ<3 잔존');
      console.log('✅ 적용 확인: consultation/treatment max_occupancy >= 3, examination/laser 미변경');
    }
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
