#!/usr/bin/env node
/**
 * T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL — Phase A read-only probe.
 *
 * 목적(ground-truth, prod rxlomoozakkjesdqjtvd):
 *   (P1) 레거시 self_checkin_create(text,text,text) 존재/시그니처/proacl(EXECUTE grant)
 *        → 소스차단 baseline: anon 이미 회수(2026-07-10 allowlist)인지, authenticated/PUBLIC 잔존인지.
 *   (P2) check_ins / reservations status 분포(active 판정 근거).
 *   (P3) INV-1 divergence: reservation_id 링크된 active check_in인데 reservation.status∈{reserved,confirmed}.
 *        → 대상 행 id/근거 스냅샷(Phase B freeze셋 후보).
 *   (P4) unlinked+당일confirmed divergence(레거시 미링크 벡터의 흔적) — 기대 0.
 *
 * READ-ONLY. 어떤 write/DDL도 없음.
 */
import { q } from './dryrun_lib.mjs';

const FN = 'self_checkin_create';

function print(title, rows) {
  console.log(`\n──── ${title} ────`);
  console.log(JSON.stringify(rows, null, 2));
}

const main = async () => {
  // P1 — 함수 존재/시그니처/grant
  print('P1a: self_checkin_create 오버로드 전수(시그니처+proacl+owner)', await q(`
    SELECT p.oid,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid)             AS result,
           r.rolname                                  AS owner,
           p.prosecdef                                AS security_definer,
           p.proacl::text                             AS proacl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r     ON r.oid = p.proowner
     WHERE n.nspname='public' AND p.proname='${FN}'
     ORDER BY 1;`));

  print('P1b: EXECUTE 권한 실측(has_function_privilege) — 레거시 3-text sig', await q(`
    WITH t AS (
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='${FN}'
         AND pg_get_function_identity_arguments(p.oid)='p_clinic_slug text, p_phone text, p_name text'
    )
    SELECT
      has_function_privilege('anon',          (SELECT oid FROM t), 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', (SELECT oid FROM t), 'EXECUTE') AS authenticated_exec,
      has_function_privilege('service_role',  (SELECT oid FROM t), 'EXECUTE') AS service_role_exec;`));

  print('P1c: 비교 — self_checkin_with_reservation_link (라이브 링크 RPC) 존재/시그니처', await q(`
    SELECT pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS secdef, p.proacl::text AS proacl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='self_checkin_with_reservation_link';`));

  // P2 — status 분포
  print('P2a: check_ins.status 분포', await q(`
    SELECT status, count(*) AS n FROM public.check_ins GROUP BY 1 ORDER BY 2 DESC;`));
  print('P2b: reservations.status 분포', await q(`
    SELECT status, count(*) AS n FROM public.reservations GROUP BY 1 ORDER BY 2 DESC;`));

  // P3 — INV-1 divergence (linked active check_in ↔ reservation reserved/confirmed)
  //   active check_in = status NOT IN (완료/취소/노쇼 계열). 보수적으로 넓게 잡고 상세 dump.
  print('P3a: INV-1 후보 — 링크 check_in active + reservation∈{reserved,confirmed}', await q(`
    SELECT ci.id            AS check_in_id,
           ci.status        AS ci_status,
           ci.reservation_id,
           ci.customer_id,
           ci.clinic_id,
           ci.checked_in_at,
           ci.created_at    AS ci_created_at,
           r.status         AS resv_status,
           r.reservation_date,
           r.reservation_time,
           r.updated_at     AS resv_updated_at
      FROM public.check_ins ci
      JOIN public.reservations r ON r.id = ci.reservation_id
     WHERE ci.reservation_id IS NOT NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
       AND r.status IN ('reserved','confirmed')
     ORDER BY ci.created_at;`));

  print('P3b: INV-1 count', await q(`
    SELECT count(*) AS inv1_count
      FROM public.check_ins ci
      JOIN public.reservations r ON r.id = ci.reservation_id
     WHERE ci.reservation_id IS NOT NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
       AND r.status IN ('reserved','confirmed');`));

  // P4 — unlinked active check_in + 같은 고객·같은 날 confirmed reservation (레거시 미링크 흔적)
  print('P4: unlinked active check_in + 당일 confirmed reservation(동일 고객)', await q(`
    SELECT ci.id AS check_in_id, ci.status AS ci_status, ci.customer_id,
           ci.checked_in_at::date AS ci_date,
           r.id AS resv_id, r.status AS resv_status, r.reservation_date
      FROM public.check_ins ci
      JOIN public.reservations r
        ON r.customer_id = ci.customer_id
       AND r.reservation_date = ci.checked_in_at::date
       AND r.status = 'confirmed'
     WHERE ci.reservation_id IS NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
     ORDER BY ci.checked_in_at;`));

  console.log('\n✅ probeA done (read-only).');
};

main().catch(e => { console.error('PROBE FAIL:', e.message); process.exit(1); });
