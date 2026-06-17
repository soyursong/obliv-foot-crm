/**
 * T-20260617-foot-CHECKIN-CHART-LINK-3KEY — AC-4 데이터 정정 인벤토리 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. 어떤 UPDATE/DELETE 도 실행하지 않는다. supervisor DB 게이트 전까지 정비 금지.
 *
 * 산출: 성함 불일치 오배정 체크인 전수 — ci.customer_name ≠ 연결된 customers.name
 *   (= phone 단독 매칭으로 타 환자에 오연결된 후보군). 각 row 의 "올바른 후보"(성함+연락처 복합 1건)도 산출.
 *   교차오염(오배정 차트에 실환자 form_submissions/payments 기록) 동반 점검.
 */
import pg from 'pg';

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const canon = (s) => {
  const d = (s ?? '').toString().replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) return '82' + d.slice(1);
  return d;
};

async function main() {
  await client.connect();

  // 성함 불일치 오배정 체크인 (clinic 스코프, cancelled 제외)
  const mis = await client.query(`
    SELECT ci.id AS check_in_id, ci.clinic_id, ci.customer_id AS linked_id,
           ci.customer_name, ci.customer_phone, ci.status, ci.created_at,
           c.name AS linked_name, c.phone AS linked_phone, c.chart_number AS linked_chart
      FROM check_ins ci
      JOIN customers c ON c.id = ci.customer_id
     WHERE ci.status <> 'cancelled'
       AND ci.customer_name IS NOT NULL
       AND trim(ci.customer_name) <> ''
       AND trim(coalesce(c.name,'')) <> ''
       AND trim(ci.customer_name) <> trim(c.name)
     ORDER BY ci.created_at DESC
  `);

  const out = [];
  for (const r of mis.rows) {
    // 올바른 후보: clinic + 성함(ci.customer_name) AND 연락처(ci.customer_phone) 복합
    const cand = await client.query(
      `SELECT id, name, phone, chart_number FROM customers
        WHERE clinic_id = $1 AND name = $2`,
      [r.clinic_id, (r.customer_name || '').trim()],
    );
    const ciCanon = canon(r.customer_phone);
    const phoneMatched = cand.rows.filter((c) => canon(c.phone) === ciCanon && ciCanon !== '');
    // 오배정 차트(linked_id)의 의료기록 교차오염
    let fs = 0, pay = 0;
    try { fs = (await client.query(`SELECT count(*)::int n FROM form_submissions WHERE customer_id=$1`, [r.linked_id])).rows[0].n; } catch {}
    try { pay = (await client.query(`SELECT count(*)::int n FROM payments WHERE customer_id=$1`, [r.linked_id])).rows[0].n; } catch {}
    out.push({
      check_in_id: r.check_in_id,
      created_at: r.created_at,
      status: r.status,
      ci_name: r.customer_name,
      ci_phone: r.customer_phone,
      linked_WRONG: `${r.linked_name} (${r.linked_id.slice(0, 8)} / ${r.linked_chart ?? '∅'})`,
      correct_candidates: phoneMatched.map((c) => `${c.name} (${c.id.slice(0, 8)} / ${c.chart_number ?? '∅'})`),
      correct_count: phoneMatched.length,
      resolvable: phoneMatched.length === 1,
      wrong_chart_form_submissions: fs,
      wrong_chart_payments: pay,
    });
  }

  console.log(JSON.stringify({ total_mismatch: out.length, rows: out }, null, 2));
  await client.end();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
