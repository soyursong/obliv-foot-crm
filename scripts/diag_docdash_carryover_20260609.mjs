/**
 * T-20260609-foot-DOCDASH-LABEL-RX-REFINE item5 후속 (READ-ONLY DIAG)
 * 현장: 진료환자목록에 어제(2026-06-08) 날짜로 비종료(payment_waiting 등) 환자 잔존 → 더미 의심.
 * prod(rxlomoozakkjesdqjtvd) 조회만. 코드/DB 변경 절대 없음 (SELECT only).
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const log = (...a) => console.log(...a);

try {
  await client.connect();
  log('✅ prod DB 연결 (rxlomoozakkjesdqjtvd) — READ-ONLY\n');

  // [0] check_ins 컬럼 확인
  const cols = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins' ORDER BY ordinal_position;`);
  log('── [0] check_ins 컬럼 ──');
  log('  ' + cols.rows.map(r => r.column_name).join(', '));
  log('');

  // [1] customers 컬럼 (is_simulation / memo / phone 확인용)
  const ccols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;`);
  log('── [0b] customers 컬럼 ──');
  log('  ' + ccols.rows.map(r => r.column_name).join(', '));
  log('');

  // [0c] clinics 매핑
  log('── [0c] clinics (slug↔id) ──');
  const clinics = await client.query(`SELECT id, slug, name FROM clinics ORDER BY slug;`);
  for (const r of clinics.rows) log(`  ${r.slug} | ${r.id} | ${r.name}`);
  log('');

  // [2] 어제(2026-06-08) ~ 최근 비종료 status check_ins
  log('── [1] 비종료 status check_ins (checked_in_at 2026-06-07 이후) ──');
  const q = await client.query(`
    SELECT ci.id AS check_in_id,
           ci.status,
           ci.checked_in_at,
           cl.slug AS clinic_slug,
           ci.customer_name AS ci_name,
           ci.customer_phone AS ci_phone,
           c.id AS customer_id,
           c.name AS customer_name,
           c.phone,
           c.is_simulation,
           c.memo,
           c.customer_memo
    FROM check_ins ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    LEFT JOIN clinics cl ON cl.id = ci.clinic_id
    WHERE ci.checked_in_at >= '2026-06-07 00:00:00+09'
      AND ci.status NOT IN ('completed','cancelled','no_show','done','finished')
    ORDER BY ci.checked_in_at DESC
    LIMIT 200;`);
  log(`  rows: ${q.rowCount}`);
  for (const r of q.rows) {
    const ph = r.phone || r.ci_phone;
    const mm = r.memo || r.customer_memo;
    const dummyMarker =
      (r.is_simulation === true ? 'SIM ' : '') +
      ((mm && /\[TEST-DUMMY/.test(mm)) ? 'MEMO-DUMMY ' : '') +
      ((ph && (/^\+?82?10880/.test(ph) || /^\+?82?10881/.test(ph) || /^010880/.test(ph) || /^010881/.test(ph))) ? 'PHONE-DUMMY ' : '');
    log(`  • ${r.checked_in_at?.toISOString?.() ?? r.checked_in_at} | status=${r.status} | clinic=${r.clinic_slug} | 환자=${r.customer_name ?? r.ci_name} | phone=${ph} | is_simulation=${r.is_simulation} | memo=${mm ? JSON.stringify(String(mm).slice(0,40)) : 'NULL'} | DUMMY?[${dummyMarker.trim() || 'NONE'}]`);
  }
  log('');

  // [3] status 분포 (어제~최근)
  log('── [2] status 분포 (checked_in_at 2026-06-07 이후) ──');
  const dist = await client.query(`
    SELECT cl.slug AS clinic_slug, ci.status, count(*)
    FROM check_ins ci LEFT JOIN clinics cl ON cl.id = ci.clinic_id
    WHERE ci.checked_in_at >= '2026-06-07 00:00:00+09'
    GROUP BY cl.slug, ci.status ORDER BY cl.slug, count(*) DESC;`);
  for (const r of dist.rows) log(`  ${r.clinic_slug} | ${r.status} | ${r.count}`);

} catch (e) {
  log('❌ ERROR:', e.message);
} finally {
  await client.end();
  log('\n✅ 연결 종료 (변경 없음)');
}
