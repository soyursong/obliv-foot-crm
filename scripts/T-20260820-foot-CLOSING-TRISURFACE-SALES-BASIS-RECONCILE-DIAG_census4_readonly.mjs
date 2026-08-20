/**
 * T-20260820 TRISURFACE RECONCILE — census part 4 (READ-ONLY)
 * DoD 보강: 현장 신고의 두 화면을 '실장(이름) grain'으로 각각 재현·대조하여
 *   같은 실장에 ①≠② 가 나는 지점을 이름·금액으로 특정한다.
 *
 *  화면① 일마감>결제내역>담당자별 소계 (Closing.tsx staffTotals):
 *     - 귀속축 = 고객의 live customers.assigned_staff_id (staff_name)
 *     - 단건 = payments, created_at 윈도, status<>'deleted' (cancelled 포함)
 *     - 패키지 = package_payments, accounting_date=D (pkgPaymentsForList)
 *     - sim/test 포함 · net(환불차감) · membership→card
 *  화면② 일마감>총매출>담당 실장별 (lib/staffRevenue.ts, consultant 뷰):
 *     - 귀속축 = COALESCE(attributed_staff_id 스냅샷, live assigned_staff_id)
 *     - 단건/패키지 = accounting_date=D, status NOT IN (cancelled,deleted)
 *     - sim/test 제외 · net · roster = role='consultant' 만
 * auth: Management API postgres 슈퍼유저(무RLS). SELECT only. prod write/DDL 0.
 */
const REF='rxlomoozakkjesdqjtvd', PAT=process.env.SUPABASE_ACCESS_TOKEN;
if(!PAT){console.error('no token');process.exit(1);}
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const o=await r.json().catch(()=>null);if(r.status!==200&&r.status!==201){console.error(`HTTP ${r.status}`,JSON.stringify(o));process.exit(1);}return o;}
const CID="'74967aea-a60b-4da3-a0e7-9c997a930bc8'";
const won=n=>Number(n).toLocaleString('ko-KR');

for (const D of ['2026-08-18','2026-08-20']) {
  const s=`${D}T00:00:00+09:00`, e=`${D}T23:59:59.999+09:00`;
  console.log(`\n================= ${D} · 실장별 ①vs② =================`);

  // ── 화면① 담당자별 소계 (live assigned_staff, sim 포함, single=created_at, pkg=accounting_date, status<>'deleted') ──
  const s1single = await q(`
    SELECT COALESCE(st.name,'미지정') staff,
      COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN staff st ON st.id=c.assigned_staff_id
    WHERE p.clinic_id=${CID} AND p.created_at>='${s}' AND p.created_at<='${e}' AND p.status<>'deleted'
    GROUP BY 1`);
  const s1pkg = await q(`
    SELECT COALESCE(st.name,'미지정') staff,
      COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM package_payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN staff st ON st.id=c.assigned_staff_id
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}'
    GROUP BY 1`);
  const s1manual = await q(`
    SELECT COALESCE(staff_name,'미지정') staff, COALESCE(SUM(amount),0) net
    FROM closing_manual_payments WHERE clinic_id=${CID} AND close_date='${D}' GROUP BY 1`);

  // ── 화면② 담당실장별 (attributed 스냅샷→live, sim 제외, accounting_date, status NOT IN cancelled/deleted, role=consultant) ──
  const s2single = await q(`
    SELECT COALESCE(st.name,'미지정') staff, st.role,
      COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM payments p LEFT JOIN customers c ON c.id=p.customer_id
      LEFT JOIN staff st ON st.id=COALESCE(p.attributed_staff_id, c.assigned_staff_id)
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted')
      AND COALESCE(c.is_simulation,false)=false AND COALESCE(c.is_test,false)=false
    GROUP BY 1,2`);
  const s2pkg = await q(`
    SELECT COALESCE(st.name,'미지정') staff, st.role,
      COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0) net
    FROM package_payments p LEFT JOIN customers c ON c.id=p.customer_id
      LEFT JOIN staff st ON st.id=COALESCE(p.attributed_staff_id, c.assigned_staff_id)
    WHERE p.clinic_id=${CID} AND p.accounting_date='${D}'
      AND COALESCE(c.is_simulation,false)=false AND COALESCE(c.is_test,false)=false
    GROUP BY 1,2`);

  // merge per-name
  const one=new Map(), two=new Map(), role=new Map();
  for(const r of [...s1single,...s1pkg,...s1manual]) one.set(r.staff,(one.get(r.staff)||0)+Number(r.net));
  for(const r of [...s2single,...s2pkg]){ two.set(r.staff,(two.get(r.staff)||0)+Number(r.net)); if(r.role)role.set(r.staff,r.role); }
  const names=[...new Set([...one.keys(),...two.keys()])].sort();

  console.log(`\n실장명           | 화면①(담당자별) | 화면②(실장별) | delta ①-② | 역할 | 비고`);
  console.log(`-----------------|----------------|--------------|-----------|------|----`);
  let t1=0,t2=0;
  for(const nm of names){
    const a=one.get(nm)||0, b=two.get(nm)||0; t1+=a; t2+=b;
    const rl=role.get(nm)||'—';
    let note='';
    if(a!==b){
      if(!two.has(nm)) note = rl==='consultant'||rl==='—' ? '②에 없음(비-consultant/미지정 roster 제외 or 귀속이동)' : '②roster제외(role='+rl+')';
      else if(!one.has(nm)) note='①에 없음(귀속 스냅샷이 이 실장으로)';
      else note='양측 존재·금액상이(귀속축/sim/cancelled/기간축)';
    }
    if(a!==0||b!==0) console.log(`${nm.padEnd(16)}| ${won(a).padStart(14)} | ${won(b).padStart(12)} | ${won(a-b).padStart(9)} | ${String(rl).padEnd(4)} | ${note}`);
  }
  console.log(`-----------------|----------------|--------------|-----------|------|----`);
  console.log(`${'합계'.padEnd(16)}| ${won(t1).padStart(14)} | ${won(t2).padStart(12)} | ${won(t1-t2).padStart(9)} |`);
}
console.log('\n=== 완료 (READ-ONLY, prod write 0) ===');
