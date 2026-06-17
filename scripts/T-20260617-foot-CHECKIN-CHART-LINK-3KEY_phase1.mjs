/**
 * T-20260617-foot-CHECKIN-CHART-LINK-3KEY — Phase 1 read-only 진단 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. 어떤 UPDATE/DELETE/ALTER 도 실행하지 않는다.
 *
 * 목적:
 *   ① 김사비 / 문자테스트 고객 레코드 + phone 중복 군집 식별
 *   ② 김사비 체크인 레코드의 customer_id 연결 경로 (오연결 여부)
 *   ③ 교차오염 점검: 문자테스트(오배정 추정) 차트에 form_submissions/payments/처방 오기록 여부
 *   ④ 실환자 vs 테스트레코드 구분
 *
 * 실행: node scripts/T-20260617-foot-CHECKIN-CHART-LINK-3KEY_phase1.mjs
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

const norm = (s) => (s ?? '').toString().replace(/[^0-9]/g, '');

async function main() {
  await client.connect();
  const out = {};

  // ① 김사비 / 문자테스트 + phone 중복 군집
  const cust = await client.query(
    `SELECT id, clinic_id, name, phone, chart_number, visit_type, created_at
       FROM customers
      WHERE name LIKE '%김사비%' OR name LIKE '%문자테스트%'
      ORDER BY created_at`,
  );
  out.target_customers = cust.rows;

  // 대상 phone 들의 중복 군집
  const phones = [...new Set(cust.rows.map((r) => norm(r.phone)).filter(Boolean))];
  if (phones.length) {
    const dup = await client.query(
      `SELECT id, clinic_id, name, phone, chart_number, visit_type, created_at
         FROM customers
        WHERE regexp_replace(coalesce(phone,''),'[^0-9]','','g') = ANY($1::text[])
        ORDER BY phone, created_at`,
      [phones],
    );
    out.phone_dup_clusters = dup.rows;
  }

  const custIds = cust.rows.map((r) => r.id);

  // ② 김사비/문자테스트 관련 체크인 (denormalized name/phone + 연결 customer_id)
  const ci = await client.query(
    `SELECT ci.id, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone,
            ci.status, ci.visit_type, ci.created_at,
            c.name AS linked_name, c.phone AS linked_phone, c.chart_number AS linked_chart
       FROM check_ins ci
       LEFT JOIN customers c ON c.id = ci.customer_id
      WHERE ci.customer_name LIKE '%김사비%'
         OR ci.customer_name LIKE '%문자테스트%'
         OR ci.customer_id = ANY($1::uuid[])
      ORDER BY ci.created_at DESC
      LIMIT 50`,
    [custIds.length ? custIds : ['00000000-0000-0000-0000-000000000000']],
  );
  out.related_checkins = ci.rows.map((r) => ({
    ...r,
    NAME_MISMATCH: (r.customer_name || '').trim() !== (r.linked_name || '').trim() && r.linked_name != null,
    PHONE_MISMATCH: r.linked_phone != null && norm(r.customer_phone) !== norm(r.linked_phone),
  }));

  // ③ 교차오염: 각 대상 고객의 form_submissions / payments / prescriptions 카운트
  out.contamination = {};
  for (const c of cust.rows) {
    const fs = await client.query(
      `SELECT count(*)::int AS n, min(created_at) AS first, max(created_at) AS last
         FROM form_submissions WHERE customer_id = $1`, [c.id]).catch((e) => ({ rows: [{ err: e.message }] }));
    const pay = await client.query(
      `SELECT count(*)::int AS n, coalesce(sum(amount),0)::bigint AS total, max(created_at) AS last
         FROM payments WHERE customer_id = $1`, [c.id]).catch((e) => ({ rows: [{ err: e.message }] }));
    let rx = { rows: [{ n: 'n/a' }] };
    try {
      rx = await client.query(`SELECT count(*)::int AS n FROM prescriptions WHERE customer_id = $1`, [c.id]);
    } catch (e) { rx = { rows: [{ err: e.message }] }; }
    out.contamination[`${c.name} (${c.id.slice(0, 8)} / chart=${c.chart_number ?? '∅'})`] = {
      phone: c.phone,
      form_submissions: fs.rows[0],
      payments: pay.rows[0],
      prescriptions: rx.rows[0],
    };
  }

  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
