/**
 * T-20260820 TRISURFACE RECONCILE — census part 3 (READ-ONLY)
 * 현재 LIVE(72b32319) 각 surface 표시값을 코드와 동일하게 재현·대조.
 *  · 합계카드 per-method = GROSS(환불 완전 제외; 476ed6e2 live) = single(created_at)Gross + pkg(created_at)Gross + manual
 *  · 담당자별 매출 소계 per-method = NET(환불 차감) = enrichedRows: single(created_at)net + pkg(accounting_date)net + manual (membership→card)
 *  · 실장별 일별 per-method/total = NET, sim/test 제외 = single+pkg(accounting_date)net
 *  · 합계카드 TOTAL = grossTotal(NET, pkg created_at) / 담당자별 TOTAL = Σ enrichedRows net(pkg accounting_date)
 * auth: Management API postgres 슈퍼유저(무RLS). SELECT only. prod write 0.
 */
const REF='rxlomoozakkjesdqjtvd', PAT=process.env.SUPABASE_ACCESS_TOKEN;
if(!PAT){console.error('no token');process.exit(1);}
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const o=await r.json().catch(()=>null);if(r.status!==200&&r.status!==201){console.error(`HTTP ${r.status}`,JSON.stringify(o));process.exit(1);}return o;}
const j=x=>JSON.stringify(x);
const CID="'74967aea-a60b-4da3-a0e7-9c997a930bc8'"; // 서울 오리진
const won=n=>Number(n).toLocaleString('ko-KR');

for (const D of ['2026-08-18','2026-08-20']) {
  const s=`${D}T00:00:00+09:00`, e=`${D}T23:59:59.999+09:00`;
  console.log(`\n============ ${D} (clinic=서울오리진) ============`);

  // 합계카드 GROSS per-method (환불 완전 제외): single(created_at) + pkg(created_at) + manual
  const sg = (await q(`SELECT method, COALESCE(SUM(amount),0) g FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted' AND payment_type<>'refund' GROUP BY method`)).reduce((m,r)=>{m[r.method]=Number(r.g);return m;},{});
  const pg = (await q(`SELECT method, COALESCE(SUM(amount),0) g FROM package_payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND payment_type<>'refund' GROUP BY method`)).reduce((m,r)=>{m[r.method]=Number(r.g);return m;},{});
  const mn = (await q(`SELECT method, COALESCE(SUM(amount),0) g FROM closing_manual_payments WHERE clinic_id=${CID} AND close_date='${D}' GROUP BY method`)).reduce((m,r)=>{m[r.method]=Number(r.g);return m;},{});
  const cardGross=(sg.card||0)+(pg.card||0)+(mn.card||0);
  const cashGross=(sg.cash||0)+(pg.cash||0)+(mn.cash||0);
  const transferGross=(sg.transfer||0)+(pg.transfer||0)+(mn.transfer||0);

  // 담당자별 소계 NET per-method (환불 차감; membership→card): single(created_at) + pkg(accounting_date) + manual
  const snCard=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted' AND method IN ('card','membership')`))[0].n;
  const snCash=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted' AND method='cash'`))[0].n;
  const snTransfer=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted' AND method='transfer'`))[0].n;
  const pnCard=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM package_payments WHERE clinic_id=${CID} AND accounting_date='${D}' AND method IN ('card','membership')`))[0].n;
  const pnCash=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM package_payments WHERE clinic_id=${CID} AND accounting_date='${D}' AND method='cash'`))[0].n;
  const pnTransfer=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM package_payments WHERE clinic_id=${CID} AND accounting_date='${D}' AND method='transfer'`))[0].n;
  const damCard=Number(snCard)+Number(pnCard)+(mn.card||0);
  const damCash=Number(snCash)+Number(pnCash)+(mn.cash||0);
  const damTransfer=Number(snTransfer)+Number(pnTransfer)+(mn.transfer||0);

  // 실장별 일별 NET total (sim/test 제외): single(accounting_date, status∉cancelled/deleted) + pkg(accounting_date)
  const dsSingle=(await q(`SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) n FROM payments p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted') AND COALESCE(c.is_simulation,false)=false AND COALESCE(c.is_test,false)=false`))[0].n;
  const dsPkg=(await q(`SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) n FROM package_payments p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND COALESCE(c.is_simulation,false)=false AND COALESCE(c.is_test,false)=false`))[0].n;
  const silTotal=Number(dsSingle)+Number(dsPkg);

  // 담당자별/결제내역 grand total (NET, sim 포함, pkg accounting_date)
  const damTotal=damCard+damCash+damTransfer;
  // 합계카드 grand total = grossTotal (NET, pkg created_at) — 별도 계산
  const gtSingle=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}' AND status<>'deleted' AND method<>'membership'`))[0].n;
  const gtPkg=(await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) n FROM package_payments WHERE clinic_id=${CID} AND created_at>='${s}' AND created_at<='${e}'`))[0].n;
  const grossTotal=Number(gtSingle)+Number(gtPkg)+(mn.card||0)+(mn.cash||0)+(mn.transfer||0);

  console.log('\n[per-method 현금]');
  console.log(`  합계카드 현금 총합 (GROSS·환불제외)   = ${won(cashGross)}`);
  console.log(`  담당자별 매출 현금 소계 (NET·환불차감) = ${won(damCash)}`);
  console.log(`  → 현금 delta (GROSS-NET = 현금환불액)  = ${won(cashGross-damCash)}`);
  console.log('\n[per-method 카드]');
  console.log(`  합계카드 카드 총합 (GROSS)             = ${won(cardGross)}`);
  console.log(`  담당자별 매출 카드 소계 (NET·membership포함) = ${won(damCard)}`);
  console.log(`  → 카드 delta                          = ${won(cardGross-damCard)}`);
  console.log('\n[grand total]');
  console.log(`  합계카드 합계 (grossTotal·NET·pkg created_at) = ${won(grossTotal)}`);
  console.log(`  담당자별 매출 합계 (NET·pkg accounting_date)  = ${won(damTotal)}`);
  console.log(`  실장별 일별 ${D} 합계 (NET·sim제외)           = ${won(silTotal)}`);
  console.log(`  → 담당자별 vs 실장별 delta (=sim/test 포함차) = ${won(damTotal-silTotal)}`);
  console.log(`  → 합계카드 vs 담당자별 delta (=pkg축차)       = ${won(grossTotal-damTotal)}`);
}
console.log('\n=== 완료 (READ-ONLY, prod write 0) ===');
