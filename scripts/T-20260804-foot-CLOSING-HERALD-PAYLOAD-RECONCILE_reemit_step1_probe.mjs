/**
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — 재emit(revision+1) STEP1 READ-ONLY probe
 *
 * supervisor FIX-REQUEST MSG-20260804-183713-62fa (사전 승인 동봉, prod DB emit 액션 한정).
 * 목적: 07-31~08-04 foot 마감확정 + 틀린 전령이 나갔던 일자를 daily_closings actual 기준으로 실측.
 *   재emit 실행 전 대상셋 freeze + 현 outbox 상태 스냅샷(멱등·과발행 방지). 이 스크립트는 절대 write 없음.
 * author: dev-foot / 2026-08-04
 */
import { query } from './lib/foot_migration_ledger.mjs';

const rows = async (sql) => {
  const r = await query(sql);
  return Array.isArray(r) ? r : [];
};
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

console.log('════════════════════════════════════════════════════════════');
console.log(`[READ-ONLY] foot CLOSING-HERALD 재emit STEP1 probe — ${nowKst()}`);
console.log('════════════════════════════════════════════════════════════\n');

// ── 0. foot clinics ──
console.log('── 0. foot clinics ──');
const clinics = await rows(`SELECT id, slug, name FROM public.clinics ORDER BY slug;`);
console.table(clinics);

// ── 1. daily_closings foot 07-31~08-04 (status·revision·monetary) ──
console.log('\n── 1. daily_closings (07-31~08-04, foot clinics) ──');
const dc = await rows(`
  SELECT c.slug, dc.close_date, dc.status, dc.revision,
         dc.actual_card_total AS a_card, dc.actual_cash_total AS a_cash, dc.actual_transfer_total AS a_tr,
         (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
        + COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
        + COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0))::bigint AS sys_total,
         (COALESCE(dc.package_card_total,0)+COALESCE(dc.package_cash_total,0)+COALESCE(dc.package_transfer_total,0))::bigint AS pkg_total,
         (COALESCE(dc.single_card_total,0)+COALESCE(dc.single_cash_total,0)+COALESCE(dc.single_transfer_total,0))::bigint AS single_total,
         dc.closed_at, dc.unconfirmed_at
    FROM public.daily_closings dc
    JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE dc.close_date BETWEEN '2026-07-31' AND '2026-08-04'
     AND c.slug LIKE '%foot%'
   ORDER BY c.slug, dc.close_date;`);
console.table(dc);

// ── 2. closing_confirmed_outbox foot (모든 revision, 07-31~08-04) — 무엇이 나갔나 ──
console.log('\n── 2. closing_confirmed_outbox (07-31~08-04, foot) — 발행 이력 ──');
const ob = await rows(`
  SELECT o.clinic_slug, o.close_date, o.revision, o.status, o.dlq, o.superseded,
         (o.payload ->> 'schema_version') AS sv,
         (o.payload ->> 'total_amount_krw') AS total_amount_krw,
         (o.payload -> 'totals' ->> 'card') AS totals_card,
         (o.payload -> 'system_totals' ->> 'card') AS systot_card,
         o.event_id, o.sent_at, o.created_at, o.attempts, o.last_error
    FROM public.closing_confirmed_outbox o
   WHERE o.close_date BETWEEN '2026-07-31' AND '2026-08-04'
     AND o.clinic_slug LIKE '%foot%'
   ORDER BY o.clinic_slug, o.close_date, o.revision;`);
console.table(ob);

// ── 3. reader watermark 이후 신규행 유무(FIX-REQUEST rows_fetched=0 재현) ──
console.log('\n── 3. watermark 2026-08-03T15:47:12.600443+00 이후 foot outbox 신규행 ──');
const after = await rows(`
  SELECT o.clinic_slug, o.close_date, o.revision, o.status, o.created_at
    FROM public.closing_confirmed_outbox o
    JOIN public.clinics c ON c.id = o.clinic_id
   WHERE c.slug LIKE '%foot%'
     AND o.created_at > '2026-08-03T15:47:12.600443+00'::timestamptz
   ORDER BY o.created_at;`);
console.log(`  신규행 ${after.length}건`);
console.table(after);

// ── 4. 각 마감일 live 산식(v1.5) 재계산 미리보기 — 재emit 시 나갈 total ──
console.log('\n── 4. 재emit 예상 payload total (v1.5 closing_source_split, closed 일자만) ──');
const preview = [];
for (const d of dc.filter((x) => x.status === 'closed')) {
  const cid = clinics.find((c) => c.slug === d.slug)?.id;
  const srcJson = (await rows(`SELECT public.closing_source_split('${cid}'::uuid, '${d.close_date}'::date) AS j;`))[0]?.j;
  const src = typeof srcJson === 'string' ? JSON.parse(srcJson) : srcJson;
  const hm = (await rows(`
    SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)::bigint AS hm
      FROM public.payments p LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
     WHERE COALESCE(p.clinic_id, ci.clinic_id)='${cid}'::uuid AND p.is_simulation IS NOT TRUE
       AND p.status IS DISTINCT FROM 'deleted' AND p.method='health_maintenance'
       AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date='${d.close_date}'::date;`))[0]?.hm;
  const vTotal = Number(src.total);
  const vHm = Number(hm);
  const inv5delta = (vTotal - vHm) - Number(d.sys_total);
  preview.push({
    slug: d.slug, close_date: d.close_date, cur_revision: d.revision,
    v_total_S: vTotal, health_maint: vHm, sys_total: Number(d.sys_total),
    inv5_delta: inv5delta, inv5_pass: inv5delta === 0,
  });
}
console.table(preview);

console.log(`\n[probe 완료] ${nowKst()} — write 없음. 대상셋/현 outbox 상태 확인용.`);
