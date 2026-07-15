#!/usr/bin/env node
/**
 * T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL — Phase B freeze + 재검증 abort.
 *
 * data_correction_backfill_sop §2-F(per-row heal) / §3 안전 4종 준수:
 *   · 대상셋 freeze = 명시 PK VALUES 박제(시간윈도우 술어 아님).
 *   · 판정근거 스냅샷(pk, old status, 링크 앵커, count).
 *   · apply 직전 재검증 abort(각 PK가 스냅샷 지문 유지 확인, 1건이라도 drift면 abort).
 * ⚠ Phase A(소스차단) 배포 + 소스닫힘 증거 확보 後에만 heal apply. 본 스크립트는 heal 전 게이트.
 * READ-ONLY(검증만). 실제 UPDATE 는 heal 마이그레이션(20260716091000...)이 수행.
 *
 * FROZEN SET (probeA 2026-07-16, INV-1 = 1건):
 *   reservation_id = 26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a  (status stuck 'confirmed')
 *   근거 check_in  = f9840007-ed46-46c8-adba-1d92fddea4f8  (active 'treatment_waiting', 링크됨)
 *   (UUID 만 기재 — PHI(이름/전화/RRN) 미기재, phi_redaction_standard §1 준수)
 */
import { q } from './dryrun_lib.mjs';

// 명시 PK VALUES 박제 (freeze) — 시간윈도우 아님
const FROZEN = [
  {
    reservation_id: '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a',
    check_in_id:    'f9840007-ed46-46c8-adba-1d92fddea4f8',
    snapshot_resv_status: 'confirmed',           // 판정 당시 old value
    snapshot_ci_status:   'treatment_waiting',   // active
  },
];

const main = async () => {
  console.log('──── Phase B freeze 재검증 (heal apply 직전 게이트) ────');

  // 1) 전역 INV-1 count 가 여전히 1인지(스냅샷 이후 신규 divergence 유입 없음 = 잔여-트랙 clean)
  const [{ inv1_count }] = await q(`
    SELECT count(*)::int AS inv1_count
      FROM public.check_ins ci
      JOIN public.reservations r ON r.id = ci.reservation_id
     WHERE ci.reservation_id IS NOT NULL
       AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
       AND r.status IN ('reserved','confirmed');`);
  console.log(`global INV-1 count = ${inv1_count} (기대 1)`);

  let abort = false;
  if (inv1_count !== 1) {
    console.log(`⚠ INV-1 count drift (${inv1_count} ≠ 1) — 잔여 divergence 재산출 필요.`);
  }

  // 2) frozen 각 행이 스냅샷 지문을 유지하는지 재검증
  for (const f of FROZEN) {
    const rows = await q(`
      SELECT r.id AS resv_id, r.status AS resv_status,
             ci.id AS ci_id, ci.status AS ci_status, ci.reservation_id
        FROM public.reservations r
        LEFT JOIN public.check_ins ci ON ci.id = '${f.check_in_id}'
       WHERE r.id = '${f.reservation_id}';`);
    if (!rows.length) { console.log(`❌ ABORT: reservation ${f.reservation_id} 부재`); abort = true; continue; }
    const row = rows[0];
    const ok =
      row.resv_status === f.snapshot_resv_status &&
      row.ci_id === f.check_in_id &&
      row.ci_status === f.snapshot_ci_status &&
      row.reservation_id === f.reservation_id;
    console.log(`  freeze ${f.reservation_id}: resv=${row.resv_status} ci=${row.ci_status} link=${row.reservation_id} → ${ok ? 'MATCH(heal 대상 유효)' : 'DRIFT'}`);
    if (!ok) abort = true;
  }

  if (abort) {
    console.log('\n❌ 재검증 ABORT — heal 미실행. drift 조사 후 fresh 스냅샷 재산출.');
    process.exit(2);
  }
  console.log('\n✅ freeze 재검증 PASS — Phase A 소스닫힘 증거 확보 시 heal apply 가능.');
};

main().catch(e => { console.error('REVERIFY FAIL:', e.message); process.exit(1); });
