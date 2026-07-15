/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — POST-APPLY POSTVERIFY (READ-ONLY)
 * 2 due-surface 를 모두 실측:
 *   (S1) paid_amount 캐시 경로 = Packages.tsx 목록 잔금  computeOutstanding(total, paid_amount)
 *   (S2) package_payments 경로 = 차트2 미수이력 + 큐 배지(loadCustomerOutstanding)  computeOutstanding(total, Σpkg_payments)
 * net-zero(payments/closing 원장 무접점)도 재확인.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const won=(n)=>Number(n).toLocaleString('ko-KR');
const FREEZE=[{pkg:'5ed60da7-990c-4407-9d63-cf61e1714789',chart:'F-4666',name:'김지민'},{pkg:'3f4d3ec6-30e1-47a1-873d-3e798043f240',chart:'F-4716',name:'김희정'}];
// ★ gate3 편입(planner xxjs/y09q) — 취소 pkg stranded paid_amount 정리. MOVE 재집계로 59,000→0 되어야 함.
const STRANDED_CANCELLED=[{pkg:'f48cb162-d480-4e37-9864-f560d15da16d',chart:'F-4716',name:'김희정',active:'3f4d3ec6-30e1-47a1-873d-3e798043f240'}];

console.log('════════ POSTVERIFY (post-apply, READ-ONLY) ════════\n');
for (const t of FREEZE) {
  const [pk] = await q(`SELECT total_amount, paid_amount, status FROM public.packages WHERE id='${t.pkg}';`);
  const [pp] = await q(`SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net, COUNT(*) n FROM public.package_payments WHERE package_id='${t.pkg}' AND fee_kind='package';`);
  const s1_due = Math.max(0, Number(pk.total_amount) - Number(pk.paid_amount));      // Packages.tsx
  const s2_due = Math.max(0, Number(pk.total_amount) - Number(pp.net));               // chart2 미수이력 + 큐배지
  console.log(`${t.chart} ${t.name}  total=${won(pk.total_amount)} paid_amount=${won(pk.paid_amount)} pkg_payments(net,n)=${won(pp.net)},${pp.n}`);
  console.log(`   S1 (Packages.tsx paid_amount 경로) DUE = ${won(s1_due)}  → ${s1_due===0?'✅ 해소':'❌ 잔존'}`);
  console.log(`   S2 (chart2 미수이력·큐배지 package_payments 경로) DUE = ${won(s2_due)}  → ${s2_due===0?'✅ 해소':'⚠️ 잔존(구조 후속 PKG-REGEN)'}\n`);
}

// ★ 취소 pkg stranded paid_amount 정리 (gate3 편입, planner xxjs/y09q ②) — MOVE 재집계로 59,000→0
console.log('──── 취소 pkg stranded paid_amount hygiene (S3, f48cb162) ────');
for (const t of STRANDED_CANCELLED) {
  const [pk] = await q(`SELECT paid_amount, status FROM public.packages WHERE id='${t.pkg}';`);
  const ok = Number(pk.paid_amount) === 0;
  console.log(`${t.chart} ${t.name} 취소pkg ${t.pkg.slice(0,8)} status=${pk.status} paid_amount=${won(pk.paid_amount)}  → ${ok?'✅ stranded 제거(0)':'❌ 잔존(활성 pkg 와 이중계상)'}`);
}

// ★ net-zero — V-B MOVE 는 canonical(payments net + package_payments net) Δ=0. payments 단독은 −69,000(single archive-first DELETE), package_payments +69,000. (paid_amount-only 시절 "payments 불변" 가정 폐기.)
const [pay] = await q(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net FROM public.payments WHERE created_at>='2026-07-15T00:00:00+09:00' AND created_at<'2026-07-16T00:00:00+09:00';`);
const [cmp] = await q(`SELECT COUNT(*) n FROM public.closing_manual_payments WHERE close_date='2026-07-15';`);
const [ppall] = await q(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net FROM public.package_payments WHERE created_at>='2026-07-15T00:00:00+09:00' AND created_at<'2026-07-16T00:00:00+09:00';`);
const [arch] = await q(`SELECT COUNT(*) n FROM public.payments_archive WHERE archive_ticket='T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR';`).catch(()=>[{n:'(테이블 부재 — DDL 미적용)'}]);
console.log('\n──── net-zero (canonical MOVE) / 원장 무접점 ────');
console.log(`payments 07-15         = ${pay.n}행 net=${won(pay.net)}  (MOVE후: single 2건 archive-first DELETE 로 −69,000, 예: 12행→10행)`);
console.log(`package_payments 07-15 = ${ppall.n}행 net=${won(ppall.net)}  (MOVE INSERT +69,000: F-4716 59,000 + F-4666 10,000)`);
console.log(`payments_archive(본티켓) = ${arch.n}행  (single 원본 스냅샷, 매출 집계 무포함)`);
console.log(`closing_manual_payments 07-15 = ${cmp.n}행 (일마감 원장 무접점, 0)`);
console.log(`※ 불변식: canonical(payments net + package_payments net) = apply 전 baseline 과 Δ=0. payments −69,000 ↔ package_payments +69,000 상쇄.`);

// 대상외 무접점 확인 (오늘 생성 active pkg 중 paid_amount 변경분이 freeze 2건뿐인지)
const others = await q(`SELECT id, package_name, paid_amount, total_amount FROM public.packages WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' AND status='active' AND paid_amount>0 AND paid_amount=total_amount AND created_at>='2026-07-15T00:00:00+09:00' AND created_at<'2026-07-16T00:00:00+09:00';`);
console.log(`\n오늘 생성 active·완납 pkg = ${others.length}건 (freeze 2건 + 정상결제분). freeze id 포함 확인:`);
for (const o of others) console.log(`   ${o.id.slice(0,8)} ${o.package_name} paid=${won(o.paid_amount)}/${won(o.total_amount)} ${FREEZE.some(f=>f.pkg===o.id)?'←freeze':''}`);
