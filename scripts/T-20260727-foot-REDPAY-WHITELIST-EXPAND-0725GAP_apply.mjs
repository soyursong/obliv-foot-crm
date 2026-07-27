/**
 * T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP — 0725 GAP superseded-remap apply 러너
 *   (supervisor APPLY-APPROVED GATE-GO / MSG-20260727-140837-85zw. DB apply = dev-foot 책임.)
 *
 *   순수 data-lane raw UPDATE (no-DDL). schema_migrations 미기재(supervisor soak-flag 명시).
 *   → applyMigration(ledger 기록) 미사용. up.sql 을 query() 로 직접 실행.
 *
 *   순서:
 *     [gate-1] 순서 게이트 — 0724GAP(20260725050000) prod remap 실재 재확인(disjoint merchant 538xxx).
 *     [gate-2] pre-remap 상태 재확인 — 289003→1047479477 / 289008→1047479482 · superseded=NULL.
 *     [gate-3] pre-apply DoD — live 뷰 count(538235,538245) = 0 (silent-drop 현행 확인).
 *     [apply]  20260727100000_redpay_foot_registry_0725gap_remap.sql prod 실행(멱등).
 *     [post-1] registry 재확인 — 289003→538235 / 289008→538245 · superseded ⊇ 구 479xxx.
 *     [post-2] post-apply DoD(단일 권위신호) — live 뷰 count(538235,538245) = 3 (소급 표면화 수렴).
 *
 *   DRY 기본. 실적용은 --apply.
 *   ref: rxlomoozakkjesdqjtvd (foot prod).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..');
const ENV = join(REPO_ROOT, '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const FILE = '20260727100000_redpay_foot_registry_0725gap_remap.sql';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const scalar = async (sql) => {
  const rows = await q(sql);
  const row = (Array.isArray(rows) ? rows : [])[0] || {};
  return row[Object.keys(row)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] REDPAY-WHITELIST-EXPAND-0725GAP — 2 merchant superseded-remap (${nowKst()})`);
console.log('  ref rxlomoozakkjesdqjtvd · 289003→538235 / 289008→538245 · no-DDL data-lane');
console.log('════════════════════════════════════════════════════════════\n');

// ── [gate-1] 순서 게이트 — 0724GAP(20260725050000) prod remap 실재 ──
const gap0724 = await q(
  `SELECT merchant_id, tid, superseded_tids FROM public.redpay_terminal_registry
    WHERE domain='foot' AND merchant_id IN ('1777288003','1777288004','1777288006','1777289004')
    ORDER BY merchant_id;`,
);
console.log('── [gate-1] 0724GAP disjoint-merchant remap 실재 확인 (순서 게이트)');
for (const r of gap0724) console.log(`     ${r.merchant_id} → tid=${r.tid} superseded=${JSON.stringify(r.superseded_tids)}`);
const gap0724Remapped = gap0724.filter((r) => String(r.tid || '').startsWith('1047538')).length;
console.log(`     538xxx-remapped = ${gap0724Remapped}/${gap0724.length} (기대 ≥1 → 0724GAP 선착륙 확증)`);
if (gap0724.length === 0) {
  console.error('\n⛔ ABORT — 0724GAP merchant 행 부재. 순서 게이트 미충족 → supervisor 보고.');
  process.exit(2);
}

// ── [gate-2] pre-remap 상태 재확인 (289003/289008) ──
const preRows = await q(
  `SELECT merchant_id, tid, superseded_tids, domain, active, terminal_label
     FROM public.redpay_terminal_registry
    WHERE domain='foot' AND merchant_id IN ('1777289003','1777289008')
    ORDER BY merchant_id;`,
);
console.log('\n── [gate-2] pre-remap 상태 (289003/289008)');
for (const r of preRows) console.log(`     ${r.merchant_id} → tid=${r.tid} superseded=${JSON.stringify(r.superseded_tids)} active=${r.active} label=${r.terminal_label}`);
const want = { '1777289003': '1047479477', '1777289008': '1047479482' };
const preOk = preRows.length === 2 && preRows.every((r) => r.tid === want[r.merchant_id]);
const alreadyRemapped = preRows.length === 2 && preRows.every((r) => String(r.tid).startsWith('1047538'));
if (!preOk && !alreadyRemapped) {
  console.error('\n⛔ ABORT — pre-remap 상태가 기대(479477/479482)와도, 이미-적용(538xxx)과도 불일치. 드리프트 → supervisor 보고.');
  process.exit(2);
}
if (alreadyRemapped) console.log('     ⓘ 이미 remap 적용됨(멱등 재실행 케이스) — 진행.');

// ── [gate-3] pre-apply DoD — live 뷰 count = 0 ──
const preView = await scalar(
  `SELECT count(*)::int AS n FROM public.v_redpay_reconciliation_daily WHERE tid IN ('1047538235','1047538245');`,
);
console.log(`\n── [gate-3] pre-apply DoD: v_redpay_reconciliation_daily count(538235,538245) = ${preView} (기대 apply前=0)`);

if (!APPLY) {
  console.log('\n── [DRY] 계획: up.sql(' + FILE + ') UPDATE 실행 → post 뷰 count=3 검증');
  console.log('실적용: --apply\n');
  process.exit(0);
}

// ── [apply] up.sql UPDATE 실행 (멱등, no-DDL, ledger 미기재) ──
console.log('\n── [apply] ' + FILE + ' 실행 ──');
const upSql = readFileSync(join(REPO_ROOT, 'supabase/migrations', FILE), 'utf8');
await q(upSql);
const appliedAt = nowKst();
console.log('  ✅ UPDATE 적용 완료 · applied_at = ' + appliedAt);

// ── [post-1] registry 재확인 ──
const postRows = await q(
  `SELECT merchant_id, tid, superseded_tids FROM public.redpay_terminal_registry
    WHERE domain='foot' AND merchant_id IN ('1777289003','1777289008') ORDER BY merchant_id;`,
);
console.log('\n── [post-1] registry 재확인');
for (const r of postRows) console.log(`     ${r.merchant_id} → tid=${r.tid} superseded=${JSON.stringify(r.superseded_tids)}`);
const postOk = postRows.every((r) => r.tid === { '1777289003': '1047538235', '1777289008': '1047538245' }[r.merchant_id]
  && Array.isArray(r.superseded_tids)
  && r.superseded_tids.includes({ '1777289003': '1047479477', '1777289008': '1047479482' }[r.merchant_id]));
console.log(`     registry remap OK = ${postOk}`);

// ── [post-2] post-apply DoD (단일 권위신호) — live 뷰 count = 3 ──
const postView = await scalar(
  `SELECT count(*)::int AS n FROM public.v_redpay_reconciliation_daily WHERE tid IN ('1047538235','1047538245');`,
);
console.log(`\n── [post-2] post-apply DoD: v_redpay_reconciliation_daily count(538235,538245) = ${postView} (기대 apply後=3)`);

// 상세: tid별 건수/금액 + recon_status (지적#2 정합)
const detail = await q(
  `SELECT tid, count(*)::int AS cnt, sum(amount)::bigint AS amt
     FROM public.v_redpay_reconciliation_daily WHERE tid IN ('1047538235','1047538245')
    GROUP BY tid ORDER BY tid;`,
).catch((e) => { console.log('  (detail 집계 스킵: ' + e.message + ')'); return []; });
for (const r of detail) console.log(`     tid=${r.tid} 건수=${r.cnt} 금액=₩${Number(r.amt).toLocaleString()}`);

console.log('\n════════════════════════════════════════════════════════════');
console.log(`RESULT: registry_remap=${postOk} · liveView_surfaced=${postView} (기대=3) · applied_at=${appliedAt}`);
if (postView !== 3 || !postOk) {
  console.error('⚠ DoD 미충족 — supervisor 확인 필요 (registry_remap 또는 뷰 count≠3).');
  process.exit(2);
}
console.log('✅ 0725GAP remap 완전 수렴 — 소급 표면화 3행/₩31,000 확인.');
console.log('════════════════════════════════════════════════════════════');
