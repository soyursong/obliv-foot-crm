/**
 * T-20260811-foot-CUST-F5990-PKG-DELETE — Phase 1 READ-ONLY 조사
 * 강동석 #F-5990 고객 매칭 + 패키지 목록/결제연결/잔여회차/생성일 조회.
 * 파괴 write 0. Management API /database/query, READ-ONLY SELECT only.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g,'');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }
async function qj(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}
const j = (o) => JSON.stringify(o, null, 2);
(async () => {
  // 1. 고객 매칭: chart_number='F-5990'  (+ 안전차원 F-5990 / 5990 변형 확인)
  console.log('=== [1] 고객 매칭 (chart_number = F-5990) ===');
  const cust = await qj(`
    SELECT id, chart_number, name, phone, visit_type, is_test, is_simulation, created_at
    FROM customers
    WHERE chart_number IN ('F-5990','F5990','5990')
    ORDER BY chart_number`);
  console.log(j(cust));

  if (!cust.length) {
    console.log('⚠️ F-5990 매칭 0건 — 이름 강동석 fallback 조회');
    const byname = await qj(`SELECT id, chart_number, name, phone, status FROM customers WHERE name='강동석'`);
    console.log('강동석 name-match =', j(byname));
    return;
  }

  for (const c of cust) {
    const nameMatch = c.name === '강동석';
    console.log(`\n--- 고객 ${c.chart_number} / ${c.name} / id=${c.id} / 이름일치(강동석)=${nameMatch} / visit_type=${c.visit_type} / is_test=${c.is_test} ---`);

    // 2. 패키지 목록
    const pkgs = await qj(`
      SELECT p.id, p.package_name, p.package_type, p.status,
             p.total_sessions, p.total_amount, p.paid_amount,
             p.transferred_from, p.transferred_to,
             p.contract_date, p.created_at, p.created_by, p.memo,
             (SELECT COUNT(*) FROM package_sessions ps WHERE ps.package_id = p.id) AS session_rows,
             (SELECT COUNT(*) FROM package_sessions ps WHERE ps.package_id = p.id AND ps.status='used') AS used_sessions,
             (SELECT COUNT(*) FROM package_payments pp WHERE pp.package_id = p.id) AS payment_rows,
             (SELECT COUNT(*) FROM package_payments pp WHERE pp.package_id = p.id AND pp.payment_type='payment') AS pay_rows,
             (SELECT COUNT(*) FROM package_payments pp WHERE pp.package_id = p.id AND pp.payment_type='refund') AS refund_rows,
             (SELECT COALESCE(SUM(pp.amount),0) FROM package_payments pp WHERE pp.package_id = p.id AND pp.payment_type='payment') AS pay_sum,
             (SELECT COALESCE(SUM(pp.amount),0) FROM package_payments pp WHERE pp.package_id = p.id AND pp.payment_type='refund') AS refund_sum,
             (SELECT COUNT(*) FROM check_ins ci WHERE ci.package_id = p.id) AS checkin_refs
      FROM packages p
      WHERE p.customer_id = '${c.id}'
      ORDER BY p.created_at`);
    console.log(`패키지 ${pkgs.length}건:`);
    console.log(j(pkgs));

    // 3. 잔여 회차 = total_sessions - used_sessions (요약)
    for (const p of pkgs) {
      const remain = (p.total_sessions ?? 0) - Number(p.used_sessions ?? 0);
      const payLinked = Number(p.payment_rows) > 0;
      const delSafe = Number(p.session_rows)===0 && Number(p.payment_rows)===0 && Number(p.checkin_refs)===0
                      && p.status!=='transferred' && !p.transferred_from && !p.transferred_to;
      console.log(`  · [${p.package_name}] status=${p.status} | 총${p.total_sessions} 소진${p.used_sessions} 잔여${remain} | 결제연결=${payLinked}(pay${p.pay_rows}/refund${p.refund_rows}, 결제합${p.pay_sum}/환불합${p.refund_sum}) | 체크인참조=${p.checkin_refs} | delete_package_safe 통과가능=${delSafe} | 생성일=${p.created_at}`);
    }
  }
  console.log('\n=== READ-ONLY 완료. write 0. ===');
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
