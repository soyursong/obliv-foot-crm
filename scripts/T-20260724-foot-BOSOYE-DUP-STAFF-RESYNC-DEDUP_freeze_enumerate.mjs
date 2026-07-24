/**
 * T-20260724-foot-BOSOYE-DUP-STAFF-RESYNC-DEDUP — FREEZE / ENUMERATE (READ-ONLY)
 *
 * 목적: 파괴적 정정 前 prod 실재를 freeze(스냅샷)하고, 중복 박소예 staff record 5c17e4bc 를
 *       참조하는 자식 FK를 **카탈로그 기계열거**(SOP §2-0)하여 live 참조 census를 확정한다.
 *       "예약 1건"을 전량으로 신뢰 금지 — 23503은 첫 FK만 보고. pg_constraint 전량 열거.
 *
 * SOP:
 *   - Cross-CRM Data-Correction 백필 SOP: 대상셋 freeze + 판정근거 스냅샷.
 *   - Orphan-Row Archive-First + FK Integrity Guard SOP: §2-0 카탈로그 기계열거 + §2-0-b confdeltype census.
 *
 * WRITE 0 — 순수 조회. 결과를 _snapshot.json 에 저장.
 * 실행: node scripts/T-20260724-foot-BOSOYE-DUP-STAFF-RESYNC-DEDUP_freeze_enumerate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS = `${process.env.HOME}/.config/medibuilder-secrets`;
const PAT = readFileSync(`${SECRETS}/foot-supabase-pat`, 'utf8').trim();
const REF = 'rxlomoozakkjesdqjtvd';
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DUP_PARKSOYE = '5c17e4bc-e948-4dc4-a8cf-37904873edeb'; // 중복 박소예 [중복정리 2026-07-18]
const REAL_PARKSOYE = '5fb3e3b1-1c5a-461b-9159-c330a52feb95'; // 실 박소예 (F-4507 담당 정본)
const F4507_RESV = '3971c409-3204-4cc7-9525-55de422b4380';    // F-4507 최민지 소유 예약 (resync 대상)
const PRESERVE_CHART = 'F-4507';

async function sql(query) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${text}\n--query--\n${query}`);
  return JSON.parse(text);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const main = async () => {
  console.log('=== FREEZE / ENUMERATE (READ-ONLY) ===');

  // ── ① 두 박소예 staff row 실측 ──
  const staffRows = await sql(
    `SELECT id, clinic_id, name, role, active, created_at
     FROM staff WHERE id IN (${q(DUP_PARKSOYE)}, ${q(REAL_PARKSOYE)}) ORDER BY created_at`
  );
  const dup = staffRows.find(r => r.id === DUP_PARKSOYE);
  const real = staffRows.find(r => r.id === REAL_PARKSOYE);
  console.log('\n[staff rows]');
  console.log('  DUP  :', JSON.stringify(dup));
  console.log('  REAL :', JSON.stringify(real));

  // ── ② F-4507 customer 정본 designated 확인 (미변경 대상) ──
  const f4507 = await sql(
    `SELECT id, chart_number, name, designated_therapist_id
     FROM customers WHERE clinic_id=${q(CLINIC)} AND chart_number=${q(PRESERVE_CHART)}`
  );
  console.log('\n[F-4507 customer]', JSON.stringify(f4507));

  // ── ③ F-4507 예약 3971c409 preferred 확인 (resync 대상) ──
  const resv = await sql(
    `SELECT id, customer_id, preferred_therapist_id, reservation_date, status
     FROM reservations WHERE id=${q(F4507_RESV)}`
  );
  console.log('\n[F-4507 reservation 3971c409]', JSON.stringify(resv));

  // ── ④ FK 카탈로그 기계열거 — staff(id) 를 참조하는 전 FK (SOP §2-0) ──
  const fkCatalog = await sql(
    `SELECT c.conname,
            (n.nspname||'.'||t.relname) AS child_table,
            a.attname AS child_col,
            c.confdeltype  -- a=NO ACTION, r=RESTRICT, n=SET NULL, c=CASCADE, d=SET DEFAULT
     FROM pg_constraint c
     JOIN pg_class t   ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     JOIN pg_class rt  ON rt.oid = c.confrelid
     WHERE c.contype='f' AND rt.relname='staff'
     ORDER BY child_table, child_col`
  );
  console.log(`\n[FK catalog → staff(id)] ${fkCatalog.length} constraints`);
  fkCatalog.forEach(fk => console.log(`  ${fk.child_table}.${fk.child_col} (${fk.conname}) confdeltype=${fk.confdeltype}`));

  // ── ⑤ 각 자식 FK 컬럼에서 DUP 박소예 참조 census (전 컬럼 순회 — "예약 1건" 신뢰 금지) ──
  const census = [];
  for (const fk of fkCatalog) {
    const [schema, table] = fk.child_table.split('.');
    const rows = await sql(
      `SELECT count(*)::int AS n FROM ${schema}.${table} WHERE ${fk.child_col} = ${q(DUP_PARKSOYE)}`
    );
    const n = rows[0].n;
    census.push({ table: fk.child_table, col: fk.child_col, confdeltype: fk.confdeltype, dup_refs: n });
    if (n > 0) console.log(`  ★ ${fk.child_table}.${fk.child_col} → DUP refs = ${n}`);
  }
  const totalDupRefs = census.reduce((s, c) => s + c.dup_refs, 0);
  const nonzero = census.filter(c => c.dup_refs > 0);

  console.log(`\n[DUP 박소예 5c17e4bc live 참조 census] total=${totalDupRefs} across ${nonzero.length} column(s)`);
  nonzero.forEach(c => console.log(`  ${c.table}.${c.col} = ${c.dup_refs} (confdeltype=${c.confdeltype})`));

  // 참조 상세 (0이 아닌 컬럼의 실제 행 id) — F-4507 예약 외 예상 밖 참조 조기 탐지
  const refDetails = [];
  for (const c of nonzero) {
    const [schema, table] = c.table.split('.');
    // ctid = 모든 테이블에 존재하는 행 로케이터 (id 컬럼 부재 테이블 대비)
    const rows = await sql(
      `SELECT ctid::text AS row_ctid FROM ${schema}.${table} WHERE ${c.col} = ${q(DUP_PARKSOYE)} LIMIT 100`
    );
    refDetails.push({ table: c.table, col: c.col, ctids: rows.map(r => r.row_ctid) });
    console.log(`  detail ${c.table}.${c.col}: ${rows.length} rows (ctids captured)`);
  }

  const snapshot = {
    ticket: 'T-20260724-foot-BOSOYE-DUP-STAFF-RESYNC-DEDUP',
    phase: 'FREEZE/ENUMERATE (read-only)',
    clinic_id: CLINIC,
    dup_parksoye: dup || null,
    real_parksoye: real || null,
    f4507_customer: f4507[0] || null,
    f4507_reservation: resv[0] || null,
    fk_catalog: fkCatalog,
    dup_reference_census: census,
    dup_total_live_refs: totalDupRefs,
    dup_nonzero_refs: nonzero,
    dup_reference_details: refDetails,
  };
  writeFileSync(
    join(__dirname, 'T-20260724-foot-BOSOYE-DUP-STAFF-RESYNC-DEDUP_snapshot.json'),
    JSON.stringify(snapshot, null, 2)
  );
  console.log('\n✅ snapshot 저장 완료 → _snapshot.json');
};

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
