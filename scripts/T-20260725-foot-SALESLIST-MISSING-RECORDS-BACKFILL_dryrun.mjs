/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — DRY-RUN (무영속, no-persistence)
 *
 * plpgsql sentinel-abort 로 3건 INSERT 를 실행 → GET DIAGNOSTICS 로 rows-affected 누적 →
 * RAISE EXCEPTION 으로 트랜잭션 롤백(무영속). 이후 post-probe 로 실 부재 확인.
 * 각 INSERT 는 WHERE NOT EXISTS(멱등 가드) → 기존재 재실행 시 0-row (중복 방지 실증).
 *
 * *** dry-run: 영속 0. 실 INSERT 아님. ***
 * 표준: Cross-CRM Write Rows-Affected 검증 + Migration Dry-Run No-Persistence Protocol.
 */
import { q } from './dryrun_lib.mjs';
import { BACKFILL_TARGETS } from './T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL_targets.mjs';

const esc = (s) => String(s).replace(/'/g, "''");

function insertSelect(t) {
  // check_in_id/service_id/service_name/price/seller_staff_id/is_package_session
  // (id/koh_nail_sites/koh_requested/blood_test_requested/created_at = column default)
  return `
    INSERT INTO public.check_in_services
      (check_in_id, service_id, service_name, price, seller_staff_id, is_package_session)
    SELECT '${esc(t.check_in_id)}', '${esc(t.service.id)}', '${esc(t.service.name)}',
           ${t.service.price}, '${esc(t.seller_staff_id)}', false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.check_in_services cis
      JOIN public.check_ins ci ON ci.id = cis.check_in_id
      WHERE ci.customer_id = '${esc(t.customer_id)}'
        AND cis.service_id = '${esc(t.service.id)}'
        AND ci.checked_in_at >= '${t.sale_date}T00:00:00+09:00'
        AND ci.checked_in_at <= '${t.sale_date}T23:59:59+09:00'
    );`;
}

async function main() {
  console.log('===== DRY-RUN (무영속): 3건 INSERT rows-affected 실측 + 롤백 =====\n');

  const body = BACKFILL_TARGETS.map(insertSelect).join('\n');
  const harness = `
DO $$
DECLARE n int; total int := 0;
BEGIN
${BACKFILL_TARGETS.map((t) => `  ${insertSelect(t).trim()}
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'target #${t.n} ${t.name} ${t.chart}: rows-affected=%', n;`).join('\n')}
  RAISE EXCEPTION 'DRYRUN_OK_ABORT total_rows_affected=% (무영속 롤백)', total;
END $$;`;

  try {
    await q(harness);
    console.error('✗ FAIL: sentinel 미발화 (예상: DRYRUN_OK_ABORT). 영속 위험 → 중단.');
    process.exit(1);
  } catch (e) {
    const msg = String(e.message || e);
    const m = msg.match(/DRYRUN_OK_ABORT total_rows_affected=(\d+)/);
    if (!m) { console.error('✗ 예상외 오류:', msg); process.exit(1); }
    console.log(`[dry-run] sentinel 발화 OK — total rows-affected = ${m[1]} (예상 3)`);
    console.log(`[dry-run] plpgsql RAISE EXCEPTION → 트랜잭션 전량 롤백 (무영속).`);
  }

  // post-probe: 3건 실 부재 확인 (dry-run 영속 0 실증)
  console.log('\n[post-probe] dry-run 후 대상 3건 실 부재 확인 (영속 0):');
  let persisted = 0;
  for (const t of BACKFILL_TARGETS) {
    const r = await q(`
      SELECT count(*)::int AS n FROM public.check_in_services cis
      JOIN public.check_ins ci ON ci.id = cis.check_in_id
      WHERE ci.customer_id = '${esc(t.customer_id)}'
        AND cis.service_id = '${esc(t.service.id)}'
        AND ci.checked_in_at >= '${t.sale_date}T00:00:00+09:00'
        AND ci.checked_in_at <= '${t.sale_date}T23:59:59+09:00';`);
    const n = r[0].n;
    persisted += n;
    console.log(`  #${t.n} ${t.name} ${t.chart} (${t.service.name}): 현존 ${n}건 ${n === 0 ? '✓(미존재=백필대상 유지)' : '✗(이미 존재!)'}`);
  }
  console.log(`\n[결론] dry-run 영속 = 0 (post-probe 총 ${persisted}건 = pre-state 유지).`);
  console.log(`expected apply rows-affected = ${BACKFILL_TARGETS.length}, 합계금액 = ${BACKFILL_TARGETS.reduce((s,t)=>s+t.service.price,0)}원`);
  console.log('===== END DRY-RUN (영속 0) =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
