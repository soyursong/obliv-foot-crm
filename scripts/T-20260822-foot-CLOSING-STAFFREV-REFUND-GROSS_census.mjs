// T-20260822-foot-CLOSING-STAFFREV-REFUND-GROSS-DISPLAY — READ-ONLY prod census.
// DA: da_decision_foot_closing_staff_revenue_refund_basis_gross_20260822.md (Q2)
// 목적(census = dev-foot 선행):
//   ① payments/package_payments 스키마 — refund linkage 컬럼(parent_payment_id/linked_payment_id/original_*) 실재 여부
//   ② 환불행(payment_type='refund') 건수 (당월 윈도)
//   ③ NULL-linkage 환불행 건수 (anti-fabrication honest-fallback 대상 규모)
//   ④ 환불행 own attributed_staff_id vs 원결제 attributed_staff_id drift 규모(②→① inversion 노출)
//   ⑤ NET 봉투 무접촉 확인(읽기만) — write/DDL 0.
// SELECT-only. 데이터/스키마 변경 0. db_change=false.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 회계귀속일 당월 윈도(census 표본) — 8월
const FROM = '2026-08-01';
const TO = '2026-08-31';

async function main() {
  // clinic 판별 (jongno-foot)
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  const foot = clinics?.find(c => String(c.id).startsWith('74967aea'))
    ?? clinics?.find(c => /jongno.*foot|foot.*jongno|종로/i.test(`${c.slug} ${c.name}`))
    ?? clinics?.[0];
  console.log('=== clinic ===', foot?.id, foot?.slug, foot?.name);

  // ① payments 스키마 introspection (linkage 컬럼 실재?)
  const { data: paySample } = await sb.from('payments').select('*').eq('clinic_id', foot.id).limit(1);
  const payCols = paySample?.[0] ? Object.keys(paySample[0]) : [];
  console.log('\n=== payments 컬럼 목록 ===');
  console.log(payCols.join(', '));
  const linkageCandidates = payCols.filter(c =>
    /parent|linked|original|orig_|source_payment|ref_payment|reference/i.test(c));
  console.log('→ linkage 후보 컬럼:', linkageCandidates.length ? linkageCandidates.join(', ') : '(없음)');

  const { data: pkgSample } = await sb.from('package_payments').select('*').eq('clinic_id', foot.id).limit(1);
  const pkgCols = pkgSample?.[0] ? Object.keys(pkgSample[0]) : [];
  console.log('\n=== package_payments 컬럼 목록 ===');
  console.log(pkgCols.join(', '));
  const pkgLinkage = pkgCols.filter(c =>
    /parent|linked|original|orig_|source_payment|ref_payment|reference/i.test(c));
  console.log('→ linkage 후보 컬럼:', pkgLinkage.length ? pkgLinkage.join(', ') : '(없음)');

  // ② 환불행 건수 (payments, status NOT IN cancelled/deleted, 당월)
  const { data: refunds, error: rErr } = await sb
    .from('payments')
    .select(payCols.join(', '))
    .eq('clinic_id', foot.id)
    .eq('payment_type', 'refund')
    .not('status', 'in', '(cancelled,deleted)')
    .gte('accounting_date', FROM)
    .lte('accounting_date', TO);
  if (rErr) { console.log('refund query error:', rErr.message); return; }
  console.log(`\n=== ② 환불행(payments·refund·${FROM}~${TO}) 건수: ${(refunds ?? []).length} ===`);

  // ③④ linkage / drift 분석
  const linkCol = linkageCandidates[0] || null;
  let nullLinkage = 0, hasLinkage = 0, ownStaffNull = 0;
  const driftSamples = [];
  for (const r of refunds ?? []) {
    const link = linkCol ? r[linkCol] : null;
    if (!r.attributed_staff_id) ownStaffNull++;
    if (link) hasLinkage++; else nullLinkage++;
  }
  console.log(`\n=== ③ 환불행 linkage 상태 (linkage 컬럼=${linkCol ?? '없음'}) ===`);
  console.log(`  linkage 있음: ${hasLinkage} · NULL-linkage: ${nullLinkage} · own attributed_staff_id NULL: ${ownStaffNull}`);

  // ④ drift: 환불행 own attributed_staff_id vs 원결제 attributed_staff_id
  if (linkCol && hasLinkage) {
    const parentIds = [...new Set((refunds ?? []).map(r => r[linkCol]).filter(Boolean))];
    const parentMap = new Map();
    for (let i = 0; i < parentIds.length; i += 300) {
      const chunk = parentIds.slice(i, i + 300);
      const { data: parents } = await sb
        .from('payments')
        .select('id, attributed_staff_id, customer_id')
        .in('id', chunk);
      for (const p of parents ?? []) parentMap.set(p.id, p);
    }
    let drift = 0, sameStaff = 0, parentMissing = 0;
    for (const r of refunds ?? []) {
      const link = r[linkCol];
      if (!link) continue;
      const parent = parentMap.get(link);
      if (!parent) { parentMissing++; continue; }
      if (parent.attributed_staff_id !== r.attributed_staff_id) {
        drift++;
        if (driftSamples.length < 10) driftSamples.push({
          refund_id: String(r.id).slice(0, 8),
          refund_own_staff: r.attributed_staff_id ? String(r.attributed_staff_id).slice(0, 8) : null,
          parent_staff: parent.attributed_staff_id ? String(parent.attributed_staff_id).slice(0, 8) : null,
          amount: r.amount,
        });
      } else sameStaff++;
    }
    console.log(`\n=== ④ 환불행 own attributed_staff_id vs 원결제 attributed_staff_id ===`);
    console.log(`  일치(same): ${sameStaff} · DRIFT(다름): ${drift} · 원결제 조회불가: ${parentMissing}`);
    if (driftSamples.length) {
      console.log('  drift 표본(최대10):');
      for (const s of driftSamples) console.log('   ', JSON.stringify(s));
    }
    console.log('  → DRIFT>0 이면 환불행 own snapshot 사용 = ②→① inversion 노출 = linkage 배선 필요.');
    console.log('  → DRIFT=0 이면 own snapshot == 원결제 snapshot = 현행 배선이 이미 정합(재배정 미발생).');
  } else {
    console.log('\n=== ④ linkage 컬럼 부재 or linkage 있는 환불행 0 → 원결제 조인 불가 ===');
    console.log('  → honest fallback: 환불행 own attributed_staff_id(스냅샷) belt 유지 · 합성 금지.');
  }

  console.log('\n=== ⑤ NET 봉투 무접촉 확인 ===');
  console.log('  census = SELECT-only · write/RPC/DDL 0 · 신규 컬럼/테이블/enum 0 · db_change=false.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

// ── APPENDED census leg B: refund 귀속 3-axis 비교 (현행 staffTotals live vs DA 원결제 linkage) ──
async function legB() {
  const { data: clinics } = await sb.from('clinics').select('id, name, slug');
  const foot = clinics?.find(c => String(c.id).startsWith('74967aea')) ?? clinics?.[0];
  const FROM = '2026-08-01', TO = '2026-08-31';

  const { data: refunds } = await sb.from('payments')
    .select('id, amount, customer_id, attributed_staff_id, linked_payment_id, parent_payment_id')
    .eq('clinic_id', foot.id).eq('payment_type', 'refund')
    .not('status', 'in', '(cancelled,deleted)')
    .gte('accounting_date', FROM).lte('accounting_date', TO);

  // 원결제 조회 (linked_payment_id 우선, parent_payment_id 폴백)
  const parentIds = [...new Set((refunds ?? []).flatMap(r => [r.linked_payment_id, r.parent_payment_id]).filter(Boolean))];
  const parentMap = new Map();
  for (let i = 0; i < parentIds.length; i += 300) {
    const { data } = await sb.from('payments').select('id, attributed_staff_id, customer_id').in('id', parentIds.slice(i, i+300));
    for (const p of data ?? []) parentMap.set(p.id, p);
  }
  // 고객 live assigned_staff
  const custIds = [...new Set((refunds ?? []).map(r => r.customer_id).filter(Boolean))];
  const liveMap = new Map();
  for (let i = 0; i < custIds.length; i += 300) {
    const { data } = await sb.from('customers').select('id, assigned_staff_id').in('id', custIds.slice(i, i+300));
    for (const c of data ?? []) liveMap.set(c.id, c.assigned_staff_id);
  }

  let sameLiveVsDA = 0, diffLiveVsDA = 0; const diffs = [];
  for (const r of refunds ?? []) {
    const live = r.customer_id ? (liveMap.get(r.customer_id) ?? null) : null;
    const parent = parentMap.get(r.linked_payment_id) ?? parentMap.get(r.parent_payment_id) ?? null;
    // DA axis: 원결제 attributed_staff_id → (belt) 원결제 live → (honest fallback) refund own attributed → refund live
    const daStaff = (parent?.attributed_staff_id)
      ?? (parent?.customer_id ? (liveMap.get(parent.customer_id) ?? null) : null)
      ?? r.attributed_staff_id
      ?? live
      ?? null;
    if (String(live) === String(daStaff)) sameLiveVsDA++;
    else { diffLiveVsDA++; if (diffs.length < 15) diffs.push({ rid: String(r.id).slice(0,8), amount: r.amount, live: live && String(live).slice(0,8), da: daStaff && String(daStaff).slice(0,8), linked: !!(r.linked_payment_id||r.parent_payment_id) }); }
  }
  console.log('\n=== legB: refund 귀속 현행(live assigned) vs DA(원결제 linkage) ===');
  console.log(`  동일 bucket: ${sameLiveVsDA} · 다른 bucket(이동): ${diffLiveVsDA}`);
  for (const d of diffs) console.log('   ', JSON.stringify(d));
  console.log('  → 이동=0 이면 현행 live 축과 DA 원결제축이 현재 데이터상 동일 → display-decomposition 무위험.');
}
legB().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
