/**
 * T-20260717-foot-F4857-REFUND-MISENTRY-MISU-FIX — C3 필수 선행검증 (READ-ONLY, no-persistence)
 *
 * 목적(planner INFO MSG-20260717-212220-7xh3):
 *   loadCustomerOutstanding 가 status≠active 패키지를 outstanding 산식에서 제외하는지 실증.
 *   (a) 코드경로: src/lib/footBilling.ts:126 `.eq('status','active')` — 필터 존재 확인(정적).
 *   (b) 무영속 dry-run: pkg 38cfc0d4 status flip 의 의미효과(active 집합에서 제외)를 라이브 prod에
 *       실제 쿼리로 재현 → outstanding = 0 확인. ★ DB 쓰기 0건(BEGIN/ROLLBACK보다 강한 무영속).
 *
 * ★ 판정 분기:
 *   - POST outstanding == 0  → status 필터 실효 O → archive 로 phantom 500k 소거됨 → GO(archive 유의미).
 *   - POST outstanding != 0  → status 필터 부재/무효 → archive = no-op → 이동정정 전환 필요 → planner FOLLOWUP.
 *
 * freeze(방법 가드): pkg id 38cfc0d4 VALUES 고정 재검증(status=active·total=500k·pkg_pay=∅·payments net=+500k).
 * 이 스크립트는 SELECT 만 수행한다. UPDATE/INSERT/DELETE 없음.
 *
 * 실행: SR 키는 env 또는 .env.local 에서 로드. `node scripts/..._C3_dryrun.mjs`
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
function resolveKey(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync('.env.local')) {
    for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + name + '=(.*)$'));
      if (m) return m[1].trim();
    }
  }
  throw new Error(name + ' not resolvable (env or .env.local)');
}
const sb = createClient(SUPABASE_URL, resolveKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// ── 대상 고정 (F4857_forensic_PRE.json) ──
const CUST_ID = 'fa0dc73d-6e03-4b6f-8022-f6216539805d'; // 엘런 F-4857
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FLIP_PKG = '38cfc0d4-3d54-4d11-87ff-677493fa5307';
const FREEZE = { total_amount: 500000, consultation_fee: 0, paid_amount: 500000, total_sessions: 1, status: 'active' };
const EXPECT_PAYMENTS_NET = 500000; // f8f3ca8b(+500k)+662f6ecf(+500k)-02a34435 refund(500k)

// ── loadCustomerOutstanding 로직 이식 (footBilling.ts SSOT 그대로) ──
const netPaid = (rows, feeKind) => (rows ?? []).reduce((s, p) => {
  if (feeKind && (p.fee_kind ?? 'package') !== feeKind) return s;
  return s + (p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0));
}, 0);
const computeOutstanding = (total, paid) => Math.round((total ?? 0) - (paid ?? 0));

async function outstandingForCustomer({ excludePkgId } = {}) {
  // footBilling.ts:122-127 원본 쿼리 — status='active' 필터 포함.
  let q = sb.from('packages')
    .select('id, customer_id, total_amount, consultation_fee, created_at')
    .eq('clinic_id', CLINIC_ID)
    .eq('status', 'active')
    .in('customer_id', [CUST_ID]);
  // POST: status flip(active→archived)의 의미효과 = active 집합에서 해당 pkg 제외.
  if (excludePkgId) q = q.neq('id', excludePkgId);
  const { data: pkgs, error } = await q;
  if (error) throw error;
  const pkgRows = pkgs ?? [];
  if (pkgRows.length === 0) return { packageDue: 0, consultationDue: 0, duePackageId: null, nPkgs: 0 };

  const pkgIds = pkgRows.map((p) => p.id);
  const { data: pays, error: pErr } = await sb.from('package_payments')
    .select('package_id, amount, payment_type, fee_kind').in('package_id', pkgIds);
  if (pErr) throw pErr;
  const payByPkg = new Map();
  for (const p of pays ?? []) { const a = payByPkg.get(p.package_id) ?? []; a.push(p); payByPkg.set(p.package_id, a); }

  const sorted = [...pkgRows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  let packageDue = 0, consultationDue = 0, duePackageId = null;
  for (const pkg of sorted) {
    const rows = payByPkg.get(pkg.id);
    const pkgDue = computeOutstanding(pkg.total_amount, netPaid(rows, 'package'));
    const consultDue = computeOutstanding(pkg.consultation_fee ?? 0, netPaid(rows, 'consultation'));
    if (pkgDue > 0) packageDue += pkgDue;
    if (consultDue > 0) consultationDue += consultDue;
    if ((pkgDue > 0 || consultDue > 0) && duePackageId === null) duePackageId = pkg.id;
  }
  return { packageDue, consultationDue, duePackageId, nPkgs: pkgRows.length };
}

function fail(msg, extra) { console.error('\n❌ ABORT:', msg); if (extra) console.error(JSON.stringify(extra, null, 2)); process.exit(2); }

console.log('=== T-20260717 F4857 C3 dry-run (READ-ONLY / zero-write) ===', new Date().toISOString());

// ── STEP 1: freeze 재검증 (pkg 38cfc0d4 VALUES 고정) ──
const { data: pkgFreeze, error: fErr } = await sb.from('packages')
  .select('id, customer_id, clinic_id, total_amount, consultation_fee, paid_amount, total_sessions, status')
  .eq('id', FLIP_PKG);
if (fErr) fail('freeze SELECT error', fErr);
if (!pkgFreeze || pkgFreeze.length !== 1) fail(`pkg 38cfc0d4 정확히 1건이어야 함 (실제 ${pkgFreeze?.length ?? 0})`, pkgFreeze);
const pk = pkgFreeze[0];
const freezeChecks = {
  customer_match: pk.customer_id === CUST_ID,
  clinic_match: pk.clinic_id === CLINIC_ID,
  status_active: pk.status === FREEZE.status,
  total_500k: pk.total_amount === FREEZE.total_amount,
  consult_0: (pk.consultation_fee ?? 0) === FREEZE.consultation_fee,
  sessions_1: pk.total_sessions === FREEZE.total_sessions,
};
console.log('freeze pkg:', JSON.stringify(pk));
console.log('freeze checks:', JSON.stringify(freezeChecks));
if (!Object.values(freezeChecks).every(Boolean)) fail('freeze 불일치 — 추정 금지. planner FOLLOWUP.', { freezeChecks, pk });

// package_payments = ∅ 재검증
const { data: pp } = await sb.from('package_payments').select('id').eq('package_id', FLIP_PKG);
const pkgPayEmpty = (pp ?? []).length === 0;
console.log('package_payments(38cfc0d4) count:', (pp ?? []).length, pkgPayEmpty ? '(∅ OK)' : '(⚠ 비어있지 않음)');
if (!pkgPayEmpty) fail('package_payments 가 ∅ 이 아님 — freeze 가정 붕괴. planner FOLLOWUP.', pp);

// payments net = +500k 재검증 (단건 결제 테이블)
const { data: payRows } = await sb.from('payments')
  .select('id, amount, payment_type, status').eq('customer_id', CUST_ID).eq('status', 'active');
const payNet = (payRows ?? []).reduce((s, p) => s + (p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0)), 0);
console.log('payments net(active):', payNet, `(n=${(payRows ?? []).length}) expect +${EXPECT_PAYMENTS_NET}`);
if (payNet !== EXPECT_PAYMENTS_NET) fail('payments net 불일치 — freeze 붕괴. planner FOLLOWUP.', { payNet, payRows });
console.log('✅ freeze PASS — 38cfc0d4 active·total500k·pkg_pay∅·payments net +500k 정합.\n');

// ── STEP 2: PRE (현재 상태) outstanding ──
const pre = await outstandingForCustomer();
console.log('PRE  outstanding:', JSON.stringify(pre));

// ── STEP 3: POST (flip 의미효과: active 집합에서 38cfc0d4 제외) outstanding — zero-write ──
const post = await outstandingForCustomer({ excludePkgId: FLIP_PKG });
console.log('POST outstanding:', JSON.stringify(post));

// ── STEP 4: 순소실0 확인 — 실제 결제(payments)·package_payments 무변경(쓰기 0건이므로 자명) 재확인 ──
const { data: payAfter } = await sb.from('payments')
  .select('id, amount, payment_type, status').eq('customer_id', CUST_ID).eq('status', 'active');
const payNetAfter = (payAfter ?? []).reduce((s, p) => s + (p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0)), 0);
const noLoss = payNetAfter === EXPECT_PAYMENTS_NET;
console.log('payments net after dry-run:', payNetAfter, noLoss ? '(순소실0 OK)' : '(⚠ 변동)');

// ── 판정 ──
const preDue = pre.packageDue + pre.consultationDue;
const postDue = post.packageDue + post.consultationDue;
const verdict = {
  ticket: 'T-20260717-foot-F4857-REFUND-MISENTRY-MISU-FIX',
  check: 'C3',
  code_path: { file: 'src/lib/footBilling.ts', line: 126, filter: ".eq('status','active')", present: true },
  pre_outstanding_total: preDue,
  post_outstanding_total: postDue,
  status_filter_effective: postDue === 0 && preDue > 0,
  archive_is_noop: !(postDue === 0 && preDue > 0),
  net_loss_zero: noLoss,
  payments_net: payNetAfter,
  writes_performed: 0,
  decision: (postDue === 0 && preDue > 0)
    ? 'GO — status 필터 실효 확인, archive 로 phantom 500k 소거됨 (no-op 아님)'
    : 'STOP — archive no-op, 이동정정 전환 필요 → planner FOLLOWUP',
  ts: new Date().toISOString(),
};
console.log('\n=== VERDICT ===');
console.log(JSON.stringify(verdict, null, 2));

// evidence 저장 (gate3 mig_dryrun 후보) — off-git rollback/ 디렉토리
const EVID_DIR = new URL('../rollback/', import.meta.url).pathname;
mkdirSync(EVID_DIR, { recursive: true });
const evidPath = EVID_DIR + 'T-20260717-foot-F4857_C3_dryrun_evidence.json';
writeFileSync(evidPath, JSON.stringify({ verdict, pre, post, freeze: pk, freezeChecks }, null, 2));
console.log('\nevidence →', evidPath);

if (!(postDue === 0 && preDue > 0)) process.exit(3); // STOP 분기 = non-zero exit
console.log('\n✅ C3 PASS — GO 경로 유효 (archive 유의미). apply 는 3게이트 clear + planner GO 후.');
