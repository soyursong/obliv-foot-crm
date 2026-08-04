/**
 * T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE — READ-ONLY dry-run / drift re-verify.
 * 목적: (1) freeze snapshot 대비 prod 라이브 drift 재검(§6-3) (2) 현재/투영 구성적 오라클(§5)
 *       (3) closing outbox 7/30·7/31·8/1 status(발송 여부) 확인 (4) evidence JSON 산출.
 * READ-ONLY — SELECT only. 어떤 write/DDL 도 하지 않는다. (F4857 forensic 하네스 idiom 계승)
 * SSOT: da_decision_foot_payment_dup_entangled_set_reconcile_20260804.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const CUST = '9487b2f7-0769-4038-a373-84182f6acc11';
const PKG  = 'cd91e487-8ee9-4701-b40c-ab1cef60a2cd';

// freeze-set (snapshot phaseA) — 명시 PK VALUES + 기대값
const FREEZE_PAY = [
  { id: '46821230-d76e-49ab-b5c3-a9e69a5a5255', ptype: 'payment', amt: 8800,    link: null, tag: 'target#1 7/30단건중복' },
  { id: 'e0dc5d36-6530-44ec-b848-10b1b590b2d2', ptype: 'refund',  amt: 8800,    link: '46821230-d76e-49ab-b5c3-a9e69a5a5255', tag: 'target#1 undo(linked)' },
  { id: 'fa509f09-48bb-4859-a470-589e15df1868', ptype: 'payment', amt: 1400000, link: null, tag: '팬텀 단건(pkg=NULL)' },
  { id: '73e604cf-9b78-4f86-b5c9-a09f204cf086', ptype: 'payment', amt: 8800,    link: null, tag: '중복 의심(박민지 confirm 토글)' },
];
const FREEZE_PKGPAY = [
  { id: '38b5c660-787a-4beb-9da6-a2bc32f12f65', ptype: 'payment', amt: 1400000, tag: 'target#2 완납패키지 중복' },
  { id: '5182ecea-d124-419b-94e9-742e04d9b944', ptype: 'refund',  amt: 1400000, tag: 'target#2 undo' },
];

const out = { ticket: 'T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE', mode: 'READ-ONLY dry-run', drift: [], oracle: {}, outbox: [] };

// ── 1) DRIFT RE-VERIFY: freeze 각 행의 현재 상태 조회 ─────────────────────────
const payIds = FREEZE_PAY.map(f => `'${f.id}'`).join(',');
const curPay = await q(`SELECT id, payment_type, amount, status, linked_payment_id, package_id
  FROM public.payments WHERE id IN (${payIds});`);
for (const f of FREEZE_PAY) {
  const c = curPay.find(x => x.id === f.id);
  if (!c) { out.drift.push({ id: f.id, tag: f.tag, drift: 'ROW-MISSING (이미 삭제/변경?)' }); continue; }
  const problems = [];
  if (c.payment_type !== f.ptype) problems.push(`ptype ${c.payment_type}≠${f.ptype}`);
  if (Number(c.amount) !== f.amt) problems.push(`amt ${c.amount}≠${f.amt}`);
  if (c.status !== 'active') problems.push(`status ${c.status}≠active`);
  if ((c.linked_payment_id || null) !== f.link) problems.push(`link ${c.linked_payment_id}≠${f.link}`);
  if (c.package_id !== null) problems.push(`package_id ${c.package_id}≠NULL`);
  out.drift.push({ id: f.id, tag: f.tag, drift: problems.length ? problems.join('; ') : 'OK(no drift)' });
}
const pkgIds = FREEZE_PKGPAY.map(f => `'${f.id}'`).join(',');
const curPkg = await q(`SELECT id, payment_type, amount, package_id, customer_id
  FROM public.package_payments WHERE id IN (${pkgIds});`);
for (const f of FREEZE_PKGPAY) {
  const c = curPkg.find(x => x.id === f.id);
  if (!c) { out.drift.push({ id: f.id, tag: f.tag, drift: 'ROW-MISSING' }); continue; }
  const problems = [];
  if (c.payment_type !== f.ptype) problems.push(`ptype ${c.payment_type}≠${f.ptype}`);
  if (Number(c.amount) !== f.amt) problems.push(`amt ${c.amount}≠${f.amt}`);
  if (c.package_id !== PKG) problems.push(`pkg ${c.package_id}≠${PKG}`);
  out.drift.push({ id: f.id, tag: f.tag, drift: problems.length ? problems.join('; ') : 'OK(no drift)' });
}

// ── 2) 현재 상태 오라클 (정합 前) ────────────────────────────────────────────
const curState = await q(`
  SELECT
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
       FROM public.payments WHERE customer_id='${CUST}' AND status='active' AND package_id IS NULL) AS single_net_now,
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
       FROM public.package_payments WHERE package_id='${PKG}') AS pkg_net_now,
    (SELECT paid_amount FROM public.packages WHERE id='${PKG}') AS paid_cache_now,
    (SELECT total_amount FROM public.packages WHERE id='${PKG}') AS pkg_total;
`);
out.oracle.current = curState[0];

// ── 3) 투영 오라클 (정합 後, 두 토글 branch) ─────────────────────────────────
//   제거 대상 single: target#1(+8800), undo(−8800), phantom(+1.4M) [+ 73(+8800) if include]
//   제거 대상 pkg: target#2(+1.4M), undo(−1.4M) → net 0 제거 → pkg net = 2.4M
const s = curState[0];
const singleRemoveBase = 8800 + (-8800) + 1400000; // target#1 + undo + phantom = 1,400,000
out.oracle.projected = {
  '73_HOLD(default)':    { single_net: Number(s.single_net_now) - singleRemoveBase,          expect: 17600 },
  '73_REMOVE(confirmed)':{ single_net: Number(s.single_net_now) - singleRemoveBase - 8800,    expect: 8800  },
  pkg_net_after: Number(s.pkg_net_now) - 1400000 + 1400000, // −target#2 +undo(refund 제거=+1.4M) → 2.4M
  paid_cache_after: 2400000,
  balance_after: Number(s.pkg_total) - 2400000,
};

// ── 4) closing outbox status (7/30·7/31·8/1) — 발송 여부 ─────────────────────
try {
  out.outbox = await q(`
    SELECT close_date, revision, superseded, COALESCE(dlq,false) AS dlq,
           (payload->>'total_amount_krw') AS total_krw, created_at
    FROM public.closing_confirmed_outbox
    WHERE close_date IN ('2026-07-30','2026-07-31','2026-08-01')
    ORDER BY close_date, revision;
  `);
} catch (e) { out.outbox = [{ note: 'outbox 조회 실패(테이블/컬럼): ' + String(e).slice(0,120) }]; }

// ── 결과 출력 + evidence ─────────────────────────────────────────────────────
const driftFail = out.drift.filter(d => !/^OK/.test(d.drift));
out.verdict = driftFail.length ? `DRIFT-DETECTED(${driftFail.length}) → apply 前 재-freeze/재-CONSULT` : 'NO-DRIFT (freeze 유효)';
console.log(JSON.stringify(out, null, 2));
const path = 'evidence/T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE_dryrun.json';
try { writeFileSync(path, JSON.stringify(out, null, 2)); console.error('evidence →', path); } catch {}
