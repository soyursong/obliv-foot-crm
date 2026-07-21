/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — AC-2 §4-B PREFLIGHT (READ-ONLY)
 *
 * DA 3차 VERIFY GREENLIT (MSG-20260721-150028-4ug6). 본 스크립트는 **읽기 전용**:
 *   1) off-git 전-컬럼 스냅샷 dump (customers 9 + check_ins 6 + status_transitions 7)
 *      → no-snapshot-no-delete 하드 precondition 충족 (status_transitions 포함).
 *   2) §2-3 재검증 guard: freeze 라이브 카운트(9/6) + status_transitions(7) + 자식 0 재확인.
 *   3) 술어-스코프 self-test (독립 재판정, §4-B ②): freeze PK 전량이 DUMMY 이름접두를
 *      가지는지 + freeze ⊆ 술어-재스캔 집합인지 독립 확인. silent-swallow 가드(빈결과 ABORT).
 *   DELETE·write 0. 원장 무접점. 실 DELETE 는 apply 러너(--apply) + supervisor DB-GATE + 형 apply_gate.
 *
 * 실행:  node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_preflight.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  FREEZE_CUSTOMERS, FREEZE_CHECKINS, EXPECT, DUMMY_NAME_PREFIXES,
  OFFGIT_SNAPSHOT_DIR, FREEZE_SOURCE_COMMIT, TICKET,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_freeze.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const log = [];
const out = (s) => { console.log(s); log.push(s); };
let ABORT = false;
const fail = (s) => { ABORT = true; out('  ❌ ABORT: ' + s); };
const ok = (s) => out('  ✅ ' + s);

out(`# ${TICKET} — AC-2 §4-B PREFLIGHT (READ-ONLY)  ${new Date().toISOString()}`);
out(`freeze source commit: ${FREEZE_SOURCE_COMMIT}  |  keyed on FIXED PK (no LIKE re-scan for selection)`);

// helper: head count with .in filter on a column; returns {n, colOk}
async function inCount(table, col, ids) {
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).in(col, ids);
  if (error) {
    // 42703 = undefined_column → 해당 키 없음(정상). 그 외 오류는 표면화.
    if (/column .* does not exist|42703/i.test(error.message)) return { n: 0, colOk: false };
    return { n: null, colOk: false, err: error.message };
  }
  return { n: count, colOk: true };
}

// ── 1) freeze 라이브 재검증 (§2-3) + 전-컬럼 fetch (snapshot용) ──
out('\n## 1) FREEZE live re-verify + full-column fetch');
const { data: custRows, error: custErr } = await sb.from('customers').select('*').in('id', FREEZE_CUSTOMERS);
if (custErr) fail('customers fetch: ' + custErr.message);
const { data: ciRows, error: ciErr } = await sb.from('check_ins').select('*').in('id', FREEZE_CHECKINS);
if (ciErr) fail('check_ins fetch: ' + ciErr.message);
const { data: stRows, error: stErr } = await sb.from('status_transitions').select('*').in('check_in_id', FREEZE_CHECKINS);
if (stErr) fail('status_transitions fetch: ' + stErr.message);

const nCust = custRows?.length ?? 0, nCi = ciRows?.length ?? 0, nSt = stRows?.length ?? 0;
(nCust === EXPECT.customers ? ok : fail)(`customers live = ${nCust} (expect ${EXPECT.customers})`);
(nCi === EXPECT.check_ins ? ok : fail)(`check_ins live = ${nCi} (expect ${EXPECT.check_ins})`);
(nSt === EXPECT.status_transitions ? ok : fail)(`status_transitions (CASCADE) = ${nSt} (expect ${EXPECT.status_transitions})`);

// check_ins 전량 freeze customer 소유 재확인
if (ciRows) {
  const custSet = new Set(FREEZE_CUSTOMERS);
  const orphanFK = ciRows.filter((r) => !custSet.has(r.customer_id));
  (orphanFK.length === 0 ? ok : fail)(`check_ins.customer_id ⊆ freeze customers (외부참조 ${orphanFK.length})`);
}

// ── 2) 자식 census = 0 재확인 (§2-3, 0 아니면 §1 heavy 회부) ──
out('\n## 2) child census must be 0 (else §4-B abort → §1 heavy)');
for (const table of EXPECT.zero_children) {
  const byCust = await inCount(table, 'customer_id', FREEZE_CUSTOMERS);
  const byCi = await inCount(table, 'check_in_id', FREEZE_CHECKINS);
  if (byCust.err) { fail(`${table} customer_id probe error: ${byCust.err}`); continue; }
  if (byCi.err) { fail(`${table} check_in_id probe error: ${byCi.err}`); continue; }
  if (!byCust.colOk && !byCi.colOk) { fail(`${table}: 검증 가능한 FK 컬럼 없음 (customer_id/check_in_id 부재) — verify 불가`); continue; }
  const total = (byCust.n || 0) + (byCi.n || 0);
  const via = [byCust.colOk ? `customer_id=${byCust.n}` : null, byCi.colOk ? `check_in_id=${byCi.n}` : null].filter(Boolean).join(', ');
  (total === 0 ? ok : fail)(`${table} children = ${total} [${via}] (expect 0)`);
}

// ── 3) 술어-스코프 self-test (독립 재판정, §4-B ②) ──
out('\n## 3) predicate self-test (independent re-adjudication)');
// 3a) freeze 전량이 DUMMY 이름접두를 갖는가
if (custRows) {
  const nonDummy = custRows.filter((r) => !DUMMY_NAME_PREFIXES.some((p) => (r.name || '').startsWith(p)));
  (nonDummy.length === 0 ? ok : fail)(`freeze 전량 DUMMY 접두 매칭 (비매칭 ${nonDummy.length})`);
  if (nonDummy.length) out('    비매칭 id: ' + nonDummy.map((r) => r.id).join(', '));
}
// 3b) 술어 재스캔 → freeze ⊆ 술어집합 + silent-swallow 가드
let predIds = new Set();
for (const p of DUMMY_NAME_PREFIXES) {
  const { data, error } = await sb.from('customers').select('id,name').like('name', `${p}%`);
  if (error) { fail(`predicate scan '${p}%' error: ${error.message}`); continue; }
  (data || []).forEach((r) => predIds.add(r.id));
}
if (predIds.size === 0) fail('술어 재스캔 결과 0행 — silent-swallow 의심 (배선 오류)');
else ok(`술어 재스캔 집합 크기 = ${predIds.size} (silent-swallow 가드 통과)`);
const missing = FREEZE_CUSTOMERS.filter((id) => !predIds.has(id));
(missing.length === 0 ? ok : fail)(`freeze ⊆ 술어집합 (술어 미포함 freeze ${missing.length})`);
if (missing.length) out('    술어 미포함 freeze id: ' + missing.join(', '));

// ── 4) off-git 전-컬럼 스냅샷 dump (no-snapshot-no-delete) ──
out('\n## 4) off-git full-column snapshot (no-snapshot-no-delete)');
const snapDir = join(homedir(), '.config/medibuilder-secrets/backfill-snapshots', OFFGIT_SNAPSHOT_DIR);
let snapWritten = false;
if (!ABORT && custRows && ciRows && stRows) {
  mkdirSync(snapDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const snapshot = {
    ticket: TICKET, freeze_source_commit: FREEZE_SOURCE_COMMIT, captured_at: new Date().toISOString(),
    note: 'FULL-FIDELITY incl PII. OFF-GIT ONLY. Rollback source for §4-B plain-DELETE. status_transitions included per DA 3차 C4.',
    counts: { customers: custRows.length, check_ins: ciRows.length, status_transitions: stRows.length },
    customers: custRows, check_ins: ciRows, status_transitions: stRows,
  };
  const snapPath = join(snapDir, `snapshot_${stamp}.json`);
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  snapWritten = true;
  ok(`snapshot 기록: ${snapPath}`);
  ok(`snapshot counts: customers=${custRows.length} check_ins=${ciRows.length} status_transitions=${stRows.length}`);
} else {
  fail('ABORT 상태 or 데이터 결측 → snapshot 미기록 (no-snapshot-no-delete: DELETE 진행 금지)');
}

// ── verdict ──
out('\n## VERDICT');
out(ABORT
  ? '  ❌ PREFLIGHT ABORT — §4-B apply 진행 금지. drift/오류 해소 후 재실행.'
  : `  ✅ PREFLIGHT PASS — 선택 무결·자식0·술어 self-test 통과·snapshot 기록(${snapWritten}). apply 러너 dry-run 진행 가능. 실 DELETE=supervisor DB-GATE + 형 apply_gate.`);

// in-repo evidence (PII 없음: 카운트/판정만)
const evDir = join(REPO, 'db-gate/census-dummy-cleanup');
mkdirSync(evDir, { recursive: true });
writeFileSync(join(evDir, 'ac2_preflight_readonly_evidence.txt'), log.join('\n') + '\n');

process.exit(ABORT ? 1 : 0);
