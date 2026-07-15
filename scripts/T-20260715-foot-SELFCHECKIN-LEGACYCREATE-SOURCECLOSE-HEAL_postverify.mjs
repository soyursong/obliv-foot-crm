#!/usr/bin/env node
/**
 * T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL — 사후검증 (배포 후 실행).
 *
 * Phase A(소스닫힘) + Phase B(heal) 배포 증거를 한 번에 확보. READ-ONLY.
 *
 *   [Phase A 증거] self_checkin_create(text,text,text) EXECUTE:
 *       anon / authenticated / service_role = false (소스 봉합) · postgres(owner)=true(보존).
 *       + deprecated 주석 존재.
 *   [소스닫힘 지속] unlinked active check_in + 당일 confirmed(동일 고객) = 0.
 *   [Phase B 증거] INV-1 divergence count = 0. frozen reservation 26f3e3d5… status='checked_in'.
 */
import { q } from './dryrun_lib.mjs';

const main = async () => {
  const out = {};

  const [ex] = await q(`
    WITH t AS (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='self_checkin_create'
        AND pg_get_function_identity_arguments(p.oid)='p_clinic_slug text, p_phone text, p_name text')
    SELECT has_function_privilege('anon',(SELECT oid FROM t),'EXECUTE')          AS anon_exec,
           has_function_privilege('authenticated',(SELECT oid FROM t),'EXECUTE') AS auth_exec,
           has_function_privilege('service_role',(SELECT oid FROM t),'EXECUTE')  AS service_exec,
           has_function_privilege('postgres',(SELECT oid FROM t),'EXECUTE')      AS postgres_exec,
           obj_description((SELECT oid FROM t),'pg_proc') IS NOT NULL            AS has_deprecated_comment;`);
  out.phaseA_sourceclose = ex;

  const [{ unlinked }] = await q(`
    SELECT count(*)::int AS unlinked
      FROM public.check_ins ci
      JOIN public.reservations r
        ON r.customer_id = ci.customer_id
       AND r.reservation_date = ci.checked_in_at::date
       AND r.status = 'confirmed'
     WHERE ci.reservation_id IS NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned');`);
  out.sourceclose_unlinked_confirmed = unlinked;

  const [{ inv1 }] = await q(`
    SELECT count(*)::int AS inv1
      FROM public.check_ins ci
      JOIN public.reservations r ON r.id = ci.reservation_id
     WHERE ci.reservation_id IS NOT NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
       AND r.status IN ('reserved','confirmed');`);
  out.phaseB_inv1_count = inv1;

  const [{ frozen_status }] = await q(`
    SELECT status AS frozen_status FROM public.reservations
     WHERE id='26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a';`);
  out.phaseB_frozen_reservation_status = frozen_status;

  console.log(JSON.stringify(out, null, 2));

  const passA = ex.anon_exec === false && ex.auth_exec === false && ex.service_exec === false
             && ex.postgres_exec === true && ex.has_deprecated_comment === true
             && unlinked === 0;
  const passB = inv1 === 0 && frozen_status === 'checked_in';
  console.log(`\nPhase A (source close): ${passA ? 'PASS' : 'PENDING/FAIL'}`);
  console.log(`Phase B (heal):         ${passB ? 'PASS' : 'PENDING/FAIL'}`);
  if (!(passA && passB)) process.exit(1);
  console.log('\n✅ 전체 PASS — 소스닫힘 + INV-1 heal 완결.');
};

main().catch(e => { console.error('POSTVERIFY FAIL:', e.message); process.exit(1); });
