/** Phase2 심화 진단 (READ-ONLY) — 김민준 id 이력 추적 + 셀프접수테스트 전수 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)DB_PASSWORD=m[1].trim();}
const client = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });
const KIM_ID = 'bc07b8e8-c445-4f7b-85e6-ab27d82d3296';
try {
  await client.connect();

  // 1) 김민준 row 전체
  const row = await client.query(`SELECT * FROM check_ins WHERE id=$1`, [KIM_ID]);
  console.log('▶ 김민준 check_in 전체 row:');
  console.log(JSON.stringify(row.rows[0], null, 2), '\n');

  // 2) status_transitions 이력
  const tr = await client.query(`SELECT from_status, to_status, created_at FROM status_transitions WHERE check_in_id=$1 ORDER BY created_at`, [KIM_ID]).catch(e=>({rows:[],err:e.message}));
  console.log(`▶ status_transitions ${tr.rows.length}건:`);
  for (const t of tr.rows) console.log(`  ${t.created_at?.toISOString?.()??t.created_at}: ${t.from_status} → ${t.to_status}`);
  console.log('');

  // 3) check_in_room_logs (L2 경유 여부)
  const logs = await client.query(`SELECT assigned_room, room_type, logged_at FROM check_in_room_logs WHERE check_in_id=$1 ORDER BY logged_at`, [KIM_ID]).catch(e=>({rows:[],err:e.message}));
  console.log(`▶ check_in_room_logs ${logs.rows.length}건:`);
  for (const l of logs.rows) console.log(`  ${l.logged_at?.toISOString?.()??l.logged_at}: ${l.assigned_room} (${l.room_type})`);
  console.log('');

  // 4) 셀프접수테스트 — 전 기간 전수
  const self = await client.query(`
    SELECT ci.id, ci.status, ci.laser_room, ci.treatment_room, ci.created_at, c.name
    FROM check_ins ci JOIN customers c ON c.id=ci.customer_id
    WHERE c.name ILIKE '%셀프접수%' OR c.name ILIKE '%접수테스트%'
    ORDER BY ci.created_at DESC LIMIT 10`);
  console.log(`▶ 셀프접수테스트 유사명 check_in ${self.rowCount}건(전기간):`);
  for (const s of self.rows) console.log(`  [${s.laser_room??'-'}] ${s.name} | status=${s.status} | id=${s.id} | created=${s.created_at?.toISOString?.()??s.created_at}`);
  console.log('');

  // 5) status 컬럼이 가질 수 있는 값 분포 (치료대기 매핑 확인)
  const dist = await client.query(`SELECT status, count(*) FROM check_ins WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date='2026-06-11' GROUP BY status ORDER BY 2 DESC`);
  console.log('▶ 오늘 status 분포:');
  for (const d of dist.rows) console.log(`  ${d.status}: ${d.count}`);
} catch(e){ console.error('❌', e.message); process.exit(1);} finally { await client.end(); }
