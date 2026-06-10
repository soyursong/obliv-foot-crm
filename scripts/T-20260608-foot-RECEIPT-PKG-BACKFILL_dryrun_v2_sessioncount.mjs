/**
 * T-20260608-foot-RECEIPT-PKG-BACKFILL — DRY-RUN v2 (§3-bis 회차수 재정의 반영)
 *   *** READ-ONLY. NO UPDATE / NO INSERT / NO DELETE. ***
 *
 * 배경: v1 dry-run(_dryrun.mjs)은 "영수증=무조건 패키지" 기준(10 row 전건 이관).
 *   2026-06-10 reporter(김주연 총괄)가 규칙을 회차 수 기반으로 재정의:
 *     - 귀속 대상 패키지 total_sessions == 1  → 단건(payments) 유지, 이관 제외
 *     - 귀속 대상 패키지 total_sessions >= 2  → package_payments 이관(스펙대로 금액 그대로)
 *   (T-20260610-foot-PKGCLASS-SESSION1-SINGLE 연동 / §3-bis)
 *
 * 이 v2는 GO 집행 전 "재산출"용. 회수1 제외 건수·금액·고객을 분리 표기한다.
 * 집행(실 INSERT/UPDATE)은 별도 apply 스크립트 + 총괄 GO 수신 후에만. (이 파일은 집행하지 않음)
 *
 * 귀속 규칙 (v1과 동일, c/d):
 *   (b) 범위: payments.memo='영수증 업로드' 전 row
 *   (c) 동일 고객 패키지 2개+ 우선순위:
 *       1) 활성(active) 中 가장 최근(contract_date desc, created_at desc) 1건
 *       2) 활성 없으면 → 가장 최근 패키지(상태 무관)
 *       3) 패키지 0개 → no_package (보류)
 *   (d) 금액 불일치: 회수>=2면 금액 그대로 이관(패키지 단위 금액 강제 X)
 *
 * 스키마 사전 차단(집행 시): package_payments.method CHECK IN ('card','cash','transfer')
 *   → payments의 'membership' 은 INSERT 불가(method_incompatible). refund 별도.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const ymd = (t) => (t ? String(t).slice(0, 10) : '-');

async function fetchAll(table, columns, filter) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

console.log('=== T-20260608-foot-RECEIPT-PKG-BACKFILL DRY-RUN v2 (§3-bis 회차수 재정의 / READ-ONLY) ===');
console.log('실행시각:', new Date().toISOString());

// 1) 대상 payments
const pays = await fetchAll(
  'payments',
  'id,customer_id,amount,method,payment_type,memo,check_in_id,created_at',
  (q) => q.eq('memo', '영수증 업로드')
);
console.log(`\n[1] 대상 payments(memo='영수증 업로드') 총: ${pays.length} row`);

// 2) 대상 고객 packages 전수 (total_sessions 포함)
const custIds = [...new Set(pays.map((p) => p.customer_id).filter(Boolean))];
const nullCust = pays.filter((p) => !p.customer_id);
console.log(`    고유 고객 수: ${custIds.length}` + (nullCust.length ? ` (customer_id NULL ${nullCust.length}건 별도)` : ''));

const pkgsAll = [];
for (let i = 0; i < custIds.length; i += 200) {
  const chunk = custIds.slice(i, i + 200);
  pkgsAll.push(
    ...(await fetchAll(
      'packages',
      'id,customer_id,package_name,status,total_sessions,total_amount,paid_amount,contract_date,created_at',
      (q) => q.in('customer_id', chunk)
    ))
  );
}
const pkgByCust = new Map();
for (const pk of pkgsAll) {
  if (!pkgByCust.has(pk.customer_id)) pkgByCust.set(pk.customer_id, []);
  pkgByCust.get(pk.customer_id).push(pk);
}

const custNames = new Map();
for (let i = 0; i < custIds.length; i += 200) {
  const chunk = custIds.slice(i, i + 200);
  const { data } = await sb.from('customers').select('id,name').in('id', chunk);
  (data || []).forEach((c) => custNames.set(c.id, c.name));
}

const cmpRecent = (a, b) => {
  const da = a.contract_date || a.created_at || '';
  const db = b.contract_date || b.created_at || '';
  if (db !== da) return db < da ? -1 : 1;
  return (b.created_at || '') < (a.created_at || '') ? -1 : 1;
};

function pick(customerId) {
  const list = (pkgByCust.get(customerId) || []).slice();
  if (list.length === 0) return { rule: 'no_package', pkg: null, pkgCount: 0 };
  const active = list.filter((p) => p.status === 'active').sort(cmpRecent);
  if (active.length)
    return { rule: active.length > 1 ? 'active_recent(multi)' : 'active_recent', pkg: active[0], pkgCount: list.length };
  const any = list.slice().sort(cmpRecent);
  return { rule: 'any_recent(no_active)', pkg: any[0], pkgCount: list.length };
}

// 3) 분류 + §3-bis 회차수 게이트
let noPkg = 0, migrate = 0, excludedSession1 = 0;
let methodIncompat = 0, refundRows = 0;
let sumMigrate = 0, sumExcluded = 0, sumNoPkg = 0;
const rows = [];
for (const p of pays) {
  const r = p.customer_id ? pick(p.customer_id) : { rule: 'no_package', pkg: null, pkgCount: 0 };
  let bucket;
  if (r.rule === 'no_package') {
    bucket = 'no_package(보류)';
    noPkg++;
    sumNoPkg += p.amount || 0;
  } else if ((r.pkg?.total_sessions ?? 0) <= 1) {
    // §3-bis: 회차 수 1(또는 미정의) → 단건 유지, 이관 제외
    bucket = 'excluded_session1(단건유지)';
    excludedSession1++;
    sumExcluded += p.amount || 0;
  } else {
    bucket = 'migrate(→package_payments)';
    migrate++;
    sumMigrate += p.amount || 0;
  }
  if (!['card', 'cash', 'transfer'].includes(p.method)) methodIncompat++;
  if (p.payment_type === 'refund') refundRows++;
  rows.push({
    name: custNames.get(p.customer_id) || (p.customer_id ? '(이름없음)' : '(고객없음)'),
    amount: p.amount, method: p.method, ptype: p.payment_type, paid_at: ymd(p.created_at),
    rule: r.rule, bucket,
    sessions: r.pkg ? r.pkg.total_sessions : '-',
    pkg: r.pkg
      ? `${r.pkg.package_name}[${r.pkg.status}] ${r.pkg.total_sessions}회 ${won(r.pkg.paid_amount)}/${won(r.pkg.total_amount)} (계약 ${ymd(r.pkg.contract_date)})`
      : '— (보류)',
    pkgCount: r.pkgCount,
  });
}

console.log('\n[2] §3-bis 회차수 재정의 반영 — 버킷 요약');
console.log(`    ① migrate(회수>=2, 이관)        : ${migrate} row / ${won(sumMigrate)}원`);
console.log(`    ② excluded(회수==1, 단건유지/제외): ${excludedSession1} row / ${won(sumExcluded)}원`);
console.log(`    ③ no_package(보류)               : ${noPkg} row / ${won(sumNoPkg)}원`);
console.log(`    ─ 합계: ${pays.length} row / ${won(sumMigrate + sumExcluded + sumNoPkg)}원`);
console.log(`\n    [참고] v1(무조건패키지) 대비 변화: 회수1 제외로 -${excludedSession1} row / -${won(sumExcluded)}원 이관 축소`);

console.log('\n[3] 집행 시 사전 차단 필요 플래그');
console.log(`    method 비호환(membership 등, pkg CHECK 위반): ${methodIncompat}`);
console.log(`    payment_type='refund' (환불건)               : ${refundRows}`);
console.log(`    customer_id NULL                             : ${nullCust.length}`);

console.log('\n[4] 고객별 미리보기 (전체)');
console.log('고객 | 금액 | 수단 | type | 결제일 | 회차수 | 버킷 | 귀속규칙 | 귀속패키지 | 고객패키지수');
for (const r of rows.sort((a, b) => (a.bucket > b.bucket ? 1 : a.bucket < b.bucket ? -1 : a.name > b.name ? 1 : -1))) {
  console.log(
    `${r.name} | ${won(r.amount)} | ${r.method} | ${r.ptype} | ${r.paid_at} | ${r.sessions} | ${r.bucket} | ${r.rule} | ${r.pkg} | ${r.pkgCount}`
  );
}

console.log('\n=== DRY-RUN v2 끝 (write 없음). 집행은 총괄 GO 수신 후 apply 스크립트로만. ===');
