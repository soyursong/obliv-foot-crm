/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — APPLY (게이트드 실 INSERT)
 *
 * ⛔ 실행 게이트 (전부 충족 전 no-op):
 *   1) DA CONSULT-REPLY GO (대상테이블/매출정합/멱등성 + seller 김규리 확정 + forward-only 정합)
 *   2) planner 재스코프 확정 (8→3 실백필 + 기존재 5건 처리방침)
 *   3) supervisor prod 승인
 *   → 위 충족 후에만 `DA_GO=1 PLANNER_GO=1 SUPV_GO=1 node ...apply.mjs` 로 실행.
 *
 * 안전수칙: 멱등 NOT EXISTS 가드 + RETURNING id 스냅샷(롤백근거) + rows-affected 검증
 *          (0-row+error=null 을 성공 오인 금지) + POSTCHECK(3건 재확인 + 합계 대조).
 */
import { writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';
import { BACKFILL_TARGETS } from './T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL_targets.mjs';

const esc = (s) => String(s).replace(/'/g, "''");
const SNAP = new URL('./T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL_applied_snapshot.json', import.meta.url);

function assertGates() {
  const miss = ['DA_GO', 'PLANNER_GO', 'SUPV_GO'].filter((k) => process.env[k] !== '1');
  const sellerPending = BACKFILL_TARGETS.filter((t) => t.seller_pending);
  if (miss.length) {
    console.error(`⛔ 게이트 미충족 → no-op. 필요: ${miss.join(', ')}=1`);
    if (sellerPending.length) console.error(`   + seller 미확정(김규리 admin/therapist): ${sellerPending.map((t)=>`#${t.n}`).join(',')} → DA/planner 확정 필요`);
    process.exit(2);
  }
}

async function main() {
  assertGates();
  console.log('===== APPLY: 3건 실 INSERT (게이트 통과) =====\n');
  const applied = [];
  for (const t of BACKFILL_TARGETS) {
    const rows = await q(`
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
          AND ci.checked_in_at <= '${t.sale_date}T23:59:59+09:00')
      RETURNING id;`);
    // rows-affected 검증: RETURNING 이 정확히 1행이어야 함 (0=멱등중복/거부 → 오인금지)
    if (!Array.isArray(rows) || rows.length !== 1) {
      console.error(`✗ #${t.n} ${t.name}: rows-affected=${rows?.length ?? 'null'} (기대 1) → 중단. 이미삽입/RLS거부 의심.`);
      writeFileSync(SNAP, JSON.stringify({ aborted_at: t.n, applied }, null, 2));
      process.exit(1);
    }
    console.log(`  #${t.n} ${t.name} ${t.chart} (${t.service.name} ${t.service.price}원, seller=${t.seller_name}) → id=${rows[0].id}`);
    applied.push({ n: t.n, chart: t.chart, id: rows[0].id, price: t.service.price });
  }

  // POSTCHECK
  const total = applied.reduce((s, a) => s + a.price, 0);
  console.log(`\n[POSTCHECK] 삽입 ${applied.length}건, 합계 ${total}원 (기대 3건 / 72,000원)`);
  writeFileSync(SNAP, JSON.stringify({ applied, total, at: 'set-after-run' }, null, 2));
  console.log(`[스냅샷/롤백근거] ${SNAP.pathname}`);
  console.log('\n롤백: DELETE FROM public.check_in_services WHERE id IN (<applied ids>);');
  console.log('===== END APPLY =====');
}
main().catch((e) => { console.error(e); process.exit(1); });
