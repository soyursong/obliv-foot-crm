/**
 * AC-2 SURVIVOR CENSUS (RE-SCOPE: staff-record dedup) — T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP
 *
 *   canonical DA CONSULT-REPLY(MSG-20260810-225709-8bno) 조건부 GO 수신 후 실행 leg 착수 게이트.
 *   AC-1(registrar-row) census(4253fbdf)가 실 RC 를 staff identity dup 으로 확정:
 *     강다연  4bcf55a2(08-08,무링크) + 0ff81a68(08-10,registrar 00f04818)
 *     이진석  9a429fb7(08-08,무링크) + 884b4571(08-10,registrar 88353cd4)
 *
 *   목적(INV-8-a 다축 DB ground-truth survivor 판정 근거 수집 — name-string 단독 금지):
 *     A0. staff / (가능 시) auth.users 스키마 실측 (축 컬럼 존재 확인)
 *     A1. 4 레코드 전체 컬럼 dump (legal_name·면허·email·active·role·clinic_id·created_at)
 *     A2. auth uid·last_sign_in / email_confirmed (현 로그인 실사용 축)
 *     A3. reference-edge 계수: reservation_registrars / reservations.created_by /
 *         check_ins.created_by / payments.created_by (참조 무게 축)
 *     A4. 8쌍 carve 재확인 (cross-clinic seed·정리대상 아님·불변 확인)
 *
 *   ⚠ 전부 SELECT introspection. WRITE 0 · DDL 0 · DML 0.
 *   실행: node scripts/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_ac2_survivor_census.mjs
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function assertReadOnly(sql) {
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i;
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (forbidden.test(stripped)) throw new Error(`READ-ONLY 위반 감지: ${sql.slice(0, 80)}`);
}

const PAIR = {
  '강다연': ['4bcf55a2-4472-48ac-86a1-fca4b576ac21', '0ff81a68-9696-4a3a-b7ce-38973e37ee36'],
  '이진석': ['9a429fb7-699b-4647-94da-c2ec1e61b3c9', '884b4571-fbfb-4aa7-871c-f555dc296956'],
};
const ALL_IDS = Object.values(PAIR).flat();
const IDLIST = ALL_IDS.map((s) => `'${s}'`).join(',');

const QUERIES = [
  // A0: staff 스키마 (축 컬럼 실재 확인)
  { probe: 'A0_staff_schema', label: 'staff 컬럼 스키마',
    sql: `SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='staff'
          ORDER BY ordinal_position;` },

  // A0b: staff 참조하는 전 inbound FK (merge re-point 대상 기계열거 — 손열거 금지)
  { probe: 'A0b_inbound_fk', label: 'public.staff 를 참조하는 전 FK (confrelid=staff)',
    sql: `SELECT c.conname,
                 (SELECT relname FROM pg_class WHERE oid=c.conrelid) AS child_table,
                 (SELECT string_agg(a.attname, ',') FROM unnest(c.conkey) k
                    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k) AS child_cols,
                 confdeltype AS on_delete
          FROM pg_constraint c
          WHERE c.contype='f'
            AND c.confrelid = 'public.staff'::regclass
          ORDER BY child_table;` },

  // A1: 4 레코드 전체 컬럼 dump
  { probe: 'A1_records', label: '4 dup staff 레코드 전체 컬럼',
    sql: `SELECT * FROM public.staff WHERE id IN (${IDLIST}) ORDER BY name, created_at;` },

  // A3a: reservation_registrars 링크 계수
  { probe: 'A3a_registrar_edges', label: 'reservation_registrars staff_id 링크 계수',
    sql: `SELECT staff_id, count(*) AS registrar_rows,
                 count(*) FILTER (WHERE active) AS active_rows
          FROM public.reservation_registrars
          WHERE staff_id IN (${IDLIST})
          GROUP BY staff_id;` },

  // A4: 8쌍 carve 재확인 (cross-clinic seed 불변)
  { probe: 'A4_carve_recheck', label: '8쌍 carve (cross-clinic seed) 재확인',
    sql: `SELECT name, clinic_id, staff_id, created_at
          FROM public.reservation_registrars
          WHERE name IN ('김민경','김지혜','박민석','장예지','김효신','문해민','이수빈','진운선')
          ORDER BY name, clinic_id;` },
];

// reference-edge 계수는 A0 스키마/FK 실측 후 2차 동적 생성 (컬럼명 추정 금지).
// 1차 실행에서 A0/A0b 로 실 컬럼·FK 를 확정한 뒤 A2/A3b~ 를 붙인다.

const out = { ts_note: 'READ-ONLY census, WRITE0/DDL0/DML0', ref: 'rxlomoozakkjesdqjtvd', pair: PAIR, results: {} };

for (const { probe, label, sql } of QUERIES) {
  assertReadOnly(sql);
  try {
    const rows = await q(sql);
    out.results[probe] = { label, ok: true, rows };
    console.log(`\n── ${probe}: ${label} (${Array.isArray(rows) ? rows.length : '?'} rows)`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    out.results[probe] = { label, ok: false, error: String(e).slice(0, 300) };
    console.error(`\n✗ ${probe} FAILED: ${e}`);
  }
}

mkdirSync('scripts/out', { recursive: true });
writeFileSync('scripts/out/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_ac2_survivor_census.json',
  JSON.stringify(out, null, 2));
console.log('\n✅ written scripts/out/T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP_ac2_survivor_census.json');
