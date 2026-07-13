/**
 * T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C) — 오염행 정정 STEP 0: freeze-verify probe (READ-ONLY)
 *
 * DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2 (복합 merge/re-anchor) 절차 ①→②:
 *   ①WS-A 랜딩(旣완료 13:05, commit 19944923) → ②tap-closed freeze.
 *
 * 목적: R2 freeze셋(2 UUID)의 prod 실상태를 read-only 로 확증하고, apply 전 drift 여부를 판정.
 *   - 마스킹 중복 master(customers) 2행 + 각 raw 대응행 확인
 *   - 매달린 자식(check_ins / status_transitions) 열거 + reservations 참조(=0 기대)
 *   - customers.id 를 참조하는 모든 FK 를 introspect(FK-only scope 완전성 확인)
 *   - 결정적 merge 키(check_in.reservation_id → reservations.customer_id) 존재 여부 실측
 *
 * ⚠ PHI: name/phone 은 실 PII → stdout 만(전송/커밋 금지). 커밋 evidence 는 별도 redacted 스냅샷.
 * ⚠ 완전 read-only: SELECT 만. UPDATE/DELETE/DDL/ledger insert 0.
 *
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSC-oxrow-freeze-probe.mjs
 */
import { query } from './lib/foot_migration_ledger.mjs';

// R2 freeze셋 (dev-foot 확정, VALUES 고정 — 재SELECT 로 대상 확장 금지)
const DUP = ['512998d0', '0356b229']; // 마스킹 오염 중복 master
const RAW = ['8fa12f4c', 'c51dd5e0']; // 각 raw 대응 (8fa12f4c←512998d0, c51dd5e0←0356b229)
const PREFIXES = [...DUP, ...RAW];

const like = (col, pfx) => `${col}::text LIKE '${pfx}%'`;
const anyOf = (col, pfxs) => '(' + pfxs.map((p) => like(col, p)).join(' OR ') + ')';

const log = (label, v) => console.log(`\n── ${label} ──\n` + JSON.stringify(v, null, 2));

// ── (A) customers 대상 4행 (dup 2 + raw 2) — 전체 컬럼 ──
const custs = await query(
  `SELECT id, name, phone, clinic_id, visit_type, sms_opt_in, created_at, updated_at
     FROM customers WHERE ${anyOf('id', PREFIXES)} ORDER BY created_at`
);
log('(A) customers (dup+raw) — PHI, stdout only', custs);
console.log(`(A) count = ${Array.isArray(custs) ? custs.length : 'ERR'} (기대 4: dup 2 + raw 2)`);

// ── (B) check_ins children of the 2 dup masters ──
const ci = await query(
  `SELECT id, clinic_id, customer_id, reservation_id, customer_name, customer_phone,
          status, created_at
     FROM check_ins WHERE ${anyOf('customer_id', DUP)} ORDER BY created_at`
);
log('(B) check_ins (children of dup) — PHI denorm, stdout only', ci);
const ciIds = (Array.isArray(ci) ? ci : []).map((r) => r.id);
console.log(`(B) check_ins count = ${ciIds.length}`);

// ── (C) status_transitions attached via check_in_id ──
let st = [];
if (ciIds.length) {
  st = await query(
    `SELECT * FROM status_transitions
      WHERE check_in_id IN (${ciIds.map((x) => `'${x}'`).join(',')})`
  );
}
log('(C) status_transitions (via check_in_id)', st);
console.log(`(C) status_transitions count = ${Array.isArray(st) ? st.length : 0}`);

// ── (D) reservations referencing the 2 dup as customer_id (기대 0) ──
const resv = await query(
  `SELECT id, customer_id, clinic_id, status, reservation_date, created_at
     FROM reservations WHERE ${anyOf('customer_id', DUP)}`
);
log('(D) reservations referencing dup as customer_id (기대 0)', resv);
console.log(`(D) reservations-ref-dup count = ${Array.isArray(resv) ? resv.length : 0} (기대 0)`);

// ── (E) 결정적 merge 키 실측: 자식 check_ins.reservation_id → reservations.customer_id(raw) ──
//   R2 = reservation_id 부재 예상 → 결정적 키 없음 → phone-tail+temporal+name-stem per-row confirm.
const ciResv = (Array.isArray(ci) ? ci : []).filter((r) => r.reservation_id);
console.log(`\n── (E) 결정적 merge 키(check_in.reservation_id) ── 보유 check_ins = ${ciResv.length} (R2 기대 0)`);

// ── (F) customers.id 를 참조하는 모든 FK introspect (FK-only scope 완전성) ──
const fks = await query(
  `SELECT tc.table_name, kcu.column_name, rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND ccu.column_name='id'
    ORDER BY tc.table_name`
);
log('(F) FK → customers.id (모든 자식 테이블·delete_rule)', fks);

// ── (G) check_ins.customer_name NOT NULL 여부(denorm 처리 판정용) ──
const ciCols = await query(
  `SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_name='check_ins' AND column_name IN ('customer_name','customer_phone','customer_id')`
);
log('(G) check_ins denorm 컬럼 nullable', ciCols);

console.log('\n===== FREEZE PROBE 완료 (read-only) — apply 0 · UPDATE/DELETE 0 · ledger insert 0 =====');
