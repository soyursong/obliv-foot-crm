/**
 * T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR — H3 코디 4인 활성화 (prod WRITE)
 *
 * ※ 티켓 원안은 "INSERT 4행"이었으나 H2 진단 결과 4인(김민경·김지혜·박민석·장예지)이
 *   이미 jongno-foot staff에 role='coordinator'로 등록되어 있고 전부 active=false 상태.
 *   Handover.fetchAttendees는 .eq('active', true) 필터 → 비활성 행이 roleByName 맵에서
 *   누락되어 slate fallback(노란색 미반영)이 근본원인.
 *   → INSERT(중복행 발생) 대신 기존 정규행 active=true 활성화가 올바른 최소 수정.
 *
 * 활성화 대상 (name당 1행, user_id 연결된 정규행 우선; 박민석은 단일행):
 *   김민경 = ca0e8887-1163-4c0e-bb43-76b0d56ae383 (user_id 64a1f77a)
 *   김지혜 = 735dd27a-75de-4599-86e2-9d5d04b64015 (user_id f953b4f4)
 *   박민석 = fd54a977-d203-44f6-91cb-0f1fce47dd97 (user_id null, 단일)
 *   장예지 = 0237eba4-d347-4251-bd61-32390f197f22 (user_id ea24c289)
 *
 * 트랜잭션 + before 스냅샷(롤백 근거) + 검증. DRY_RUN=1 시 ROLLBACK.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const DRY_RUN = process.env.DRY_RUN === '1';

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TARGET_IDS = [
  'ca0e8887-1163-4c0e-bb43-76b0d56ae383', // 김민경
  '735dd27a-75de-4599-86e2-9d5d04b64015', // 김지혜
  'fd54a977-d203-44f6-91cb-0f1fce47dd97', // 박민석
  '0237eba4-d347-4251-bd61-32390f197f22', // 장예지
];

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log(`MODE = ${DRY_RUN ? 'DRY_RUN (ROLLBACK)' : 'APPLY (COMMIT)'}`);

  await client.query('BEGIN');
  try {
    // before 스냅샷 (롤백 근거)
    const before = await client.query(
      `SELECT id, name, role, active FROM staff WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [TARGET_IDS]
    );
    console.log('=== BEFORE ===');
    console.table(before.rows);

    if (before.rowCount !== 4) {
      throw new Error(`대상 행 4개 아님 (${before.rowCount}). 중단.`);
    }
    for (const r of before.rows) {
      if (r.role !== 'coordinator') throw new Error(`role 불일치: ${r.name}=${r.role}`);
    }

    // UPDATE
    const upd = await client.query(
      `UPDATE staff SET active=true, updated_at=now()
        WHERE id = ANY($1::uuid[]) AND clinic_id=$2 AND role='coordinator' AND active=false
        RETURNING id, name, role, active`,
      [TARGET_IDS, JONGNO]
    );
    console.log(`=== UPDATED (${upd.rowCount}) ===`);
    console.table(upd.rows);
    if (upd.rowCount !== 4) throw new Error(`UPDATE 4행 아님 (${upd.rowCount}). 중단.`);

    // 검증: name당 active coordinator ≥ 1
    const verify = await client.query(
      `SELECT replace(name,' ','') AS nname, count(*) FILTER (WHERE active) AS active_cnt
         FROM staff
        WHERE clinic_id=$1 AND role='coordinator'
          AND replace(name,' ','') = ANY($2::text[])
        GROUP BY 1 ORDER BY 1`,
      [JONGNO, ['김민경', '김지혜', '박민석', '장예지']]
    );
    console.log('=== VERIFY name당 active coordinator 수 ===');
    console.table(verify.rows);
    for (const v of verify.rows) {
      if (Number(v.active_cnt) < 1) throw new Error(`${v.nname} active coordinator 0건`);
    }
    if (verify.rowCount !== 4) throw new Error(`검증 name 4개 아님 (${verify.rowCount})`);

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY_RUN → ROLLBACK 완료 (DB 변경 없음)');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMIT 완료 (prod 반영)');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    process.exit(1);
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
