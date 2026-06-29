/**
 * T-20260629-meta-INS-COPAY-PROD-RECONCILE — AC-F1/F2 (발톱)
 * READ-ONLY dry-run: prod service_charges vs calc_copayment(copayCalc.ts) vs 실제 수납액(payments).
 * 데이터 수정 없음 (REST GET only). 보정 필요 시 supervisor 게이트 후 별도.
 */
const URL = process.env.SUPABASE_CRM_FOOT_URL;
const KEY = process.env.SUPABASE_CRM_FOOT_SERVICE;
if (!URL || !KEY) { console.error('env SUPABASE_CRM_FOOT_URL / SUPABASE_CRM_FOOT_SERVICE 필요'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r.json();
};

// ── copayCalc.ts 산식 포팅 (순수) ──
function getBaseCopayRate(grade) {
  switch (grade) {
    case 'general': return 0.30;
    case 'low_income_1':
    case 'low_income_2': return 0.14;
    case 'medical_aid_1': return 0.00;
    case 'medical_aid_2': return 0.15;
    case 'infant': return 0.21;
    case 'elderly_flat': return 0.30;
    case 'foreigner': return 1.00;
    default: return 0.30;
  }
}
// copayCalc.ts 클라이언트 로직 (hira_score NULL → 비급여 폴백 rate=1.0)
function calcCopayment_TS(svc, clinic, grade) {
  const isCovered = !!svc.is_insurance_covered;
  if (!isCovered || grade === 'foreigner') {
    const b = svc.price ?? 0;
    return { base: b, copay: b, rate: 1.0, branch: 'noncovered/foreigner' };
  }
  if (svc.hira_score == null) {
    const b = svc.price ?? 0;
    return { base: b, copay: b, rate: 1.0, branch: 'hira_null→price_full' };
  }
  const baseRate = getBaseCopayRate(grade);
  const rate = svc.copayment_rate_override ?? baseRate;
  const unit = clinic.hira_unit_value ?? 89.4;
  const base = Math.round(svc.hira_score * unit);
  let copay;
  if (grade === 'medical_aid_1') copay = Math.min(1000, base);
  else if (grade === 'elderly_flat' && base <= 15000) copay = Math.min(1500, base);
  else { copay = Math.ceil((base * rate) / 100) * 100; if (copay > base) copay = base; }
  return { base, copay, rate, branch: grade === 'medical_aid_1' ? 'aid1_flat' : (grade === 'elderly_flat' && base <= 15000 ? 'elderly_flat' : 'rate_ceil100') };
}
// 서버 RPC v1.1 로직 (hira_score NULL + 급여 → price 를 base 로 등급률 적용)
function calcCopayment_SERVER(svc, clinic, grade) {
  const isCovered = !!svc.is_insurance_covered;
  if (!isCovered || grade === 'foreigner') {
    const b = svc.price ?? 0;
    return { base: b, copay: b, rate: 1.0, branch: 'noncovered/foreigner' };
  }
  const baseRate = getBaseCopayRate(grade);
  const rate = svc.copayment_rate_override ?? baseRate;
  const unit = clinic.hira_unit_value ?? 89.4;
  const base = svc.hira_score != null ? Math.round(svc.hira_score * unit) : (svc.price ?? 0);
  let copay;
  if (grade === 'medical_aid_1') copay = Math.min(1000, base);
  else if (grade === 'elderly_flat' && base <= 15000) copay = Math.min(1500, base);
  else { copay = Math.ceil((base * rate) / 100) * 100; if (copay > base) copay = base; }
  return { base, copay, rate, branch: svc.hira_score == null ? 'hira_null→price_base+rate' : 'normal' };
}

const won = (n) => n == null ? 'null' : n.toLocaleString('ko-KR');

(async () => {
  console.log('=== T-20260629 INS-COPAY PROD RECONCILE (발톱) — READ-ONLY ===');
  const charges = await get('service_charges?select=*&order=calculated_at.asc');
  console.log(`service_charges rows: ${charges.length}\n`);
  if (!charges.length) { console.log('대조할 청구 데이터 없음.'); return; }

  // 참조 데이터 일괄 로드
  const sids = [...new Set(charges.map(c => c.service_id))];
  const cids = [...new Set(charges.map(c => c.customer_id))];
  const clids = [...new Set(charges.map(c => c.clinic_id))];
  const chkids = [...new Set(charges.map(c => c.check_in_id))];
  const inList = (a) => `(${a.map(x => `"${x}"`).join(',')})`;
  const services = await get(`services?select=id,name,price,is_insurance_covered,hira_code,hira_score,copayment_rate_override&id=in.${inList(sids)}`);
  const customers = await get(`customers?select=id,insurance_grade&id=in.${inList(cids)}`);
  const clinics = await get(`clinics?select=id,name,hira_unit_value&id=in.${inList(clids)}`);
  const payments = await get(`payments?select=check_in_id,amount,method,payment_type&check_in_id=in.${inList(chkids)}`);
  const svcMap = Object.fromEntries(services.map(s => [s.id, s]));
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const cliMap = Object.fromEntries(clinics.map(c => [c.id, c]));
  const payByChk = {};
  for (const p of payments) {
    const sign = p.payment_type === 'refund' ? -1 : 1;
    payByChk[p.check_in_id] = (payByChk[p.check_in_id] || 0) + sign * p.amount;
  }

  const VALID_GRADES = ['general','low_income_1','low_income_2','medical_aid_1','medical_aid_2','infant','elderly_flat','foreigner','unverified'];
  const STD_RATES = new Set([0.30,0.14,0.00,0.15,0.21,1.00]);

  const chargesByChk = {};
  for (const c of charges) (chargesByChk[c.check_in_id] ||= []).push(c);

  const findings = [];
  for (const c of charges) {
    const svc = svcMap[c.service_id] || {};
    const cust = custMap[c.customer_id] || {};
    const cli = cliMap[c.clinic_id] || {};
    const gradeSnap = c.customer_grade_at_charge;
    const gradeNow = cust.insurance_grade ?? 'unverified';

    // (A) 산식 정합 — 저장된 base_amount + 등급/적용률로 "최종 단계"만 재적용
    //     (base 결정 로직은 입력데이터 영역이므로 분리; 여기선 base→copay 산식만 검증)
    const baseRateSnap = getBaseCopayRate(gradeSnap);
    const usedRate = c.copayment_rate_at_charge != null ? Number(c.copayment_rate_at_charge) : baseRateSnap;
    let formulaCopay;
    if (!c.is_insurance_covered || gradeSnap === 'foreigner') formulaCopay = c.base_amount;
    else if (gradeSnap === 'medical_aid_1') formulaCopay = Math.min(1000, c.base_amount);
    else if (gradeSnap === 'elderly_flat' && c.base_amount <= 15000) formulaCopay = Math.min(1500, c.base_amount);
    else { formulaCopay = Math.ceil((c.base_amount * baseRateSnap) / 100) * 100; if (formulaCopay > c.base_amount) formulaCopay = c.base_amount; }
    const diffSelf = formulaCopay - c.copayment_amount; // 저장 등급 기본률 기준 산식 정합

    // (B) 현재 소스 데이터로 재계산 (클라↔서버 divergence + drift)
    const liveSvc = { is_insurance_covered: svc.is_insurance_covered, hira_score: svc.hira_score, copayment_rate_override: svc.copayment_rate_override, price: svc.price };
    const tsLive = calcCopayment_TS(liveSvc, { hira_unit_value: cli.hira_unit_value }, gradeNow);
    const serverLive = calcCopayment_SERVER(liveSvc, { hira_unit_value: cli.hira_unit_value }, gradeNow);
    const diffTsServer = tsLive.copay - serverLive.copay;

    // 입력데이터 이상 플래그
    const flags = [];
    if (!VALID_GRADES.includes(gradeSnap)) flags.push(`등급값오류(스냅샷='${gradeSnap}')`);
    if (c.is_insurance_covered && c.hira_score == null) flags.push('급여인데 hira_score 없음');
    if (c.copayment_rate_at_charge != null && !STD_RATES.has(Number(c.copayment_rate_at_charge))) flags.push(`비표준 적용률(${c.copayment_rate_at_charge})`);
    // 저장 copay 가 base의 비표준 비율인 경우 (rate 미기록인데 산식과 안 맞음)
    if (c.is_insurance_covered && c.base_amount > 0) {
      const implied = c.copayment_amount / c.base_amount;
      if (!STD_RATES.has(Math.round(implied * 100) / 100) && Math.abs(diffSelf) > 0) flags.push(`암시율 ${(implied*100).toFixed(1)}% (표준등급률 아님)`);
    }

    findings.push({
      idx: findings.length + 1, check_in_id: c.check_in_id,
      service: svc.name, hira_code: svc.hira_code,
      gradeSnap, gradeNow,
      stored_copay: c.copayment_amount, stored_base: c.base_amount,
      stored_hira: c.hira_score, stored_unit: c.hira_unit_value, stored_rate: c.copayment_rate_at_charge,
      formulaCopay, tsLive_copay: tsLive.copay, serverLive_copay: serverLive.copay,
      diffSelf, diffTsServer, flags, is_covered: c.is_insurance_covered,
    });
  }

  // check_in 단위 수납 정합 (여러 라인 → 1 수납)
  const visitRecon = Object.entries(chargesByChk).map(([chk, list]) => {
    const sumCopay = list.reduce((s, c) => s + c.copayment_amount, 0);
    const paid = payByChk[chk];
    return { chk, lines: list.length, sumCopay, paid, match: paid != null && paid === sumCopay };
  });

  // 출력
  for (const f of findings) {
    const mark = (f.diffSelf !== 0 || f.flags.length) ? ' ⚠' : '';
    console.log(`#${f.idx} [${f.hira_code || '비급여'}] ${f.service}${mark}`);
    console.log(`   급여여부=${f.is_covered} | 등급 snap=${f.gradeSnap} now=${f.gradeNow}`);
    console.log(`   저장: copay=${won(f.stored_copay)} base=${won(f.stored_base)} hira=${f.stored_hira} unit=${f.stored_unit} rate=${f.stored_rate}`);
    console.log(`   산식(저장 base→copay 재적용, 등급기본률 ${getBaseCopayRate(f.gradeSnap)}): ${won(f.formulaCopay)}  → 산식정합 diff=${won(f.diffSelf)}`);
    console.log(`   현재소스: server=${won(f.serverLive_copay)} ts=${won(f.tsLive_copay)}  → ts↔server diff=${won(f.diffTsServer)}`);
    if (f.flags.length) console.log(`   ⚠ 입력데이터 이상: ${f.flags.join(' / ')}`);
    console.log('');
  }

  console.log('──── check_in 단위 수납 정합 (Σcopay vs 실수납) ────');
  for (const v of visitRecon) {
    console.log(`   check_in ${v.chk.slice(0,8)} | 라인 ${v.lines} | Σcopay=${won(v.sumCopay)} | 실수납=${won(v.paid)} | ${v.match ? '일치' : '불일치'}`);
  }

  // 요약
  const n = findings.length;
  const selfMismatch = findings.filter(f => f.diffSelf !== 0);
  const tsServerMismatch = findings.filter(f => f.diffTsServer !== 0);
  const inputFlagged = findings.filter(f => f.flags.length);
  const visitMismatch = visitRecon.filter(v => !v.match && v.paid != null);
  const visitNoPay = visitRecon.filter(v => v.paid == null);
  console.log('\n================ 요약 ================');
  console.log(`총 청구 라인: ${n} (check_in ${visitRecon.length}건)`);
  console.log(`(A) 산식 정합 불일치 (저장 copay ≠ 저장 base 산식재적용): ${selfMismatch.length}건  [${selfMismatch.map(f=>'#'+f.idx).join(',')}]`);
  console.log(`(B) 클라(copayCalc.ts)↔서버(RPC v1.1) 산식 divergence: ${tsServerMismatch.length}건  [${tsServerMismatch.map(f=>'#'+f.idx).join(',')}]`);
  console.log(`(C) 입력데이터 이상 (등급값/hira/비표준율): ${inputFlagged.length}건  [${inputFlagged.map(f=>'#'+f.idx).join(',')}]`);
  console.log(`(D) check_in 수납 불일치 (Σcopay ≠ 실수납): ${visitMismatch.length}건 (수납 없음 ${visitNoPay.length}건)`);
  const errRate = n ? ((selfMismatch.length / n) * 100).toFixed(1) : '0';
  console.log(`\n산식 자체 오차율(A): ${errRate}%  |  입력데이터 이상율(C): ${((inputFlagged.length/n)*100).toFixed(1)}%`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
