/**
 * AC-0 READ-ONLY CENSUS (착수 게이트) — T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL
 *
 *   parent T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC 의 AC-2 별건 leg.
 *   forward auto-sync 트리거 LIVE(2026-08-09T16:47Z) 후 예약등록자(원내)에
 *   강다연·이진석 코디 2행씩 중복 표시(김주연 총괄 현장 보고).
 *
 *   목적: reservation_registrars 중복행을 READ-ONLY 로 실측하여
 *     (1) dup 패턴이 "구 수동행(staff_id NULL) + 트리거행(staff_id 값)" 구조인지 확증,
 *     (2) freeze 대상셋(행 id 목록) 스냅샷,
 *     (3) DA envelope(88ke Q5: 대상=active coordinator AND 미링크·키=staff_id NOT name)
 *         밖 노출 여부(비-coordinator dup / 트리거 재발결함 / 대량행 / 예상외 구조) 판정.
 *
 *   ⚠ 전부 SELECT introspection. WRITE 0 · DDL 0 · DML 0.
 *   실행: node scripts/T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL_ac0_census.mjs
 *   필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

// SELECT-only 가드: 위험 토큰 검출 시 즉시 abort (census 오염 방지)
function assertReadOnly(sql) {
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i;
  // WITH/SELECT 만 허용. 주석 제거 후 검사.
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (forbidden.test(stripped)) throw new Error(`READ-ONLY 위반 감지: ${sql.slice(0, 80)}`);
}

const QUERIES = [
  // ── C0: reservation_registrars 스키마 (컬럼·타입 확인) ──────────────────────
  { probe: 'C0_schema', label: 'reservation_registrars 컬럼 스키마',
    sql: `SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='reservation_registrars'
          ORDER BY ordinal_position;` },

  // ── C1: 전체 행수·staff_id NULL vs 값·group 분포 (before-image 총량) ─────────
  { probe: 'C1_totals', label: '전체 reservation_registrars 총량·NULL vs 링크 분포',
    sql: `SELECT count(*) AS total_rows,
                 count(*) FILTER (WHERE staff_id IS NULL) AS null_staff_rows,
                 count(*) FILTER (WHERE staff_id IS NOT NULL) AS linked_rows,
                 count(DISTINCT group_name) AS distinct_groups
          FROM public.reservation_registrars;` },

  { probe: 'C1b_by_group', label: 'group_name 별 행수·링크 분포',
    sql: `SELECT group_name,
                 count(*) AS n,
                 count(*) FILTER (WHERE staff_id IS NULL) AS null_staff,
                 count(*) FILTER (WHERE staff_id IS NOT NULL) AS linked,
                 count(*) FILTER (WHERE active) AS active_rows
          FROM public.reservation_registrars
          GROUP BY group_name ORDER BY n DESC;` },

  // ── C2: name+group 기준 중복 그룹 census (핵심 — dup 실측) ────────────────────
  //   >1 행인 (group_name, name) 조합 = 표시 중복. 인물별 행수/링크 상태.
  { probe: 'C2_name_dups', label: 'name+group 기준 중복 그룹 (>1행) 전수',
    sql: `SELECT group_name, name,
                 count(*) AS row_count,
                 count(*) FILTER (WHERE staff_id IS NULL) AS null_staff_rows,
                 count(*) FILTER (WHERE staff_id IS NOT NULL) AS linked_rows,
                 count(*) FILTER (WHERE active) AS active_rows
          FROM public.reservation_registrars
          GROUP BY group_name, name
          HAVING count(*) > 1
          ORDER BY row_count DESC, name;` },

  // ── C3: 강다연·이진석 (및 전 dup 인물) per-row 상세 (freeze 후보 스냅샷) ──────
  //   name 이 dup 그룹에 속하는 모든 행의 id·staff_id·created_at·created_by·active.
  { probe: 'C3_dup_rows_detail', label: 'dup 그룹 소속 전 행 per-row 상세 (freeze 후보)',
    sql: `WITH dup_keys AS (
            SELECT group_name, name
            FROM public.reservation_registrars
            GROUP BY group_name, name
            HAVING count(*) > 1
          )
          SELECT r.id, r.clinic_id, r.group_name, r.name, r.staff_id,
                 r.active, r.created_by, r.created_at,
                 (r.staff_id IS NULL) AS is_manual_row
          FROM public.reservation_registrars r
          JOIN dup_keys d ON d.group_name = r.group_name AND d.name = r.name
          ORDER BY r.group_name, r.name, r.created_at NULLS FIRST;` },

  // ── C4: 전 role='coordinator' active staff (트리거 대상 모집단) + registrar 링크 상태
  { probe: 'C4_coordinators', label: 'role=coordinator active staff + registrar 링크 유무',
    sql: `SELECT s.id AS staff_id, s.name, s.role, s.active, s.clinic_id,
                 (SELECT count(*) FROM public.reservation_registrars rr
                   WHERE rr.staff_id = s.id) AS linked_registrar_rows,
                 (SELECT count(*) FROM public.reservation_registrars rr
                   WHERE rr.name = s.name AND rr.group_name = '원내') AS name_match_inclinic_rows
          FROM public.staff s
          WHERE s.role = 'coordinator'
          ORDER BY s.active DESC, s.name;` },

  // ── C5: envelope-out 검출 A — staff_id 링크됐지만 대상 staff 가 비-coordinator ─
  //   (트리거는 coordinator 한정이므로 linked 행의 staff 는 전부 coordinator 여야 함)
  { probe: 'C5_linked_noncoord', label: 'envelope-out A: 링크행의 staff 가 비-coordinator/부재',
    sql: `SELECT r.id, r.name, r.group_name, r.staff_id,
                 s.role AS staff_role, s.active AS staff_active,
                 (s.id IS NULL) AS staff_missing
          FROM public.reservation_registrars r
          LEFT JOIN public.staff s ON s.id = r.staff_id
          WHERE r.staff_id IS NOT NULL
            AND (s.id IS NULL OR s.role <> 'coordinator')
          ORDER BY r.name;` },

  // ── C6: envelope-out 검출 B — 동일 staff_id 가 같은 group 에 2행 이상 (멱등키 위반) ─
  //   partial UNIQUE(staff_id, group_name) 가 있으므로 0 이어야 정상. >0 = 트리거 재발결함.
  { probe: 'C6_staffid_dup', label: 'envelope-out B: 동일 (staff_id,group) 2행+ (멱등키 위반=트리거 재발결함)',
    sql: `SELECT staff_id, group_name, count(*) AS n
          FROM public.reservation_registrars
          WHERE staff_id IS NOT NULL
          GROUP BY staff_id, group_name
          HAVING count(*) > 1
          ORDER BY n DESC;` },

  // ── C7: 멱등키(partial UNIQUE idx) prod 실재 확인 (재-dup 차단 근거) ──────────
  { probe: 'C7_unique_idx', label: 'partial UNIQUE idx (staff_id,group_name) prod 실재',
    sql: `SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname='public' AND tablename='reservation_registrars'
          ORDER BY indexname;` },

  // ── C8: 트리거 prod 실재 확인 (forward auto-sync LIVE 근거) ───────────────────
  { probe: 'C8_trigger', label: 'trg_foot_coord_autosync_registrar prod 실재',
    sql: `SELECT tgname, pg_get_triggerdef(t.oid) AS def
          FROM pg_trigger t
          WHERE t.tgrelid = 'public.staff'::regclass
            AND NOT t.tgisinternal
          ORDER BY tgname;` },
];

const out = { ticket: 'T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL',
              phase: 'AC-0 READ-ONLY census', mode: 'READ-ONLY (SELECT only)',
              ref: 'rxlomoozakkjesdqjtvd', results: {} };

for (const { probe, label, sql } of QUERIES) {
  assertReadOnly(sql);
  try {
    const rows = await q(sql);
    out.results[probe] = { label, row_count: Array.isArray(rows) ? rows.length : null, rows };
    console.log(`\n=== ${probe}: ${label} (${Array.isArray(rows) ? rows.length : '?'} rows) ===`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    out.results[probe] = { label, error: String(e.message || e) };
    console.error(`\n!!! ${probe} FAILED: ${e.message || e}`);
  }
}

mkdirSync('scripts/out', { recursive: true });
const outPath = 'scripts/out/T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL_ac0_census.json';
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n\n[census] written → ${outPath}`);
