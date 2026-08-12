/**
 * T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT-REEMIT — AC1 RC probe (READ-ONLY)
 *
 * 목적: 부모(T-20260806-...TOTALS-RECOMPUTE-PORT) DoD "이후 신규 마감 자동 정합"이
 *       08-07~08-11 5일 연속 발산한 근본원인(RC)을 prod 실측으로 확정/반증한다.
 *
 * AC1 검증 항목:
 *   (a) 신규 outbox created_at 이 실제 자정(00:xx KST) 발화인지 + payload memo (CF-5 자동 마감 spec?)
 *   (b) daily_closings 가 emit 이후 당일 매출 등재로 drift 하는지 (closed_at·updated_at·구성분 timeline)
 *   (c) 재emit 트리거 부재 확인 (close_date 당 revision cardinality — 단일 rev0 고착 여부)
 *
 * 코드-측 사전관측(Explore): foot repo 에 CF-5 자정 자동마감 코드 부재(수동 확정만),
 *   enqueue 트리거는 status 'closed' 진입시에만 발화 → 사후 drift 재emit 경로 없음.
 *   → 본 probe 로 prod 실데이터가 이 가설과 정합/반증되는지 확정.
 *
 * READ-ONLY: SELECT / introspection 만. write/DDL 0.
 * usage: node scripts/T-20260812-foot-CLOSING-HERALD-EMIT-TIMING-DRIFT_rc_probe.mjs
 * author: dev-foot / 2026-08-12
 */
import { query } from './lib/foot_migration_ledger.mjs';

const SLUG = 'jongno-foot';
const DATES = ['2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-10','2026-08-11','2026-08-12'];
const inList = "'" + DATES.join("','") + "'";
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : (r?.result ?? r ?? []); };

console.log('════════════════════════════════════════════════════════════');
console.log(`[RC-PROBE READ-ONLY] EMIT-TIMING-DRIFT — ${SLUG} (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════');

// ── (a) outbox 신규행 created_at (KST time-of-day) + memo + status ──────────────
console.log('\n── (a) outbox rows: created_at KST + memo + status/rev/superseded/total ──');
const ob = await rows(`
  SELECT o.close_date::text AS close_date, o.revision, o.superseded, o.status, o.dlq,
         (o.payload->>'total_amount_krw') AS total_krw,
         (o.payload->>'schema_version')  AS sv,
         to_char(o.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS created_kst,
         to_char(o.created_at AT TIME ZONE 'Asia/Seoul','HH24:MI')              AS created_hhmm,
         left(coalesce(o.payload->>'memo',''),40)                              AS memo40,
         (o.payload->'totals')                                                 AS totals
    FROM public.closing_confirmed_outbox o
    JOIN public.clinics c ON c.id = o.clinic_id
   WHERE c.slug = '${SLUG}' AND o.close_date IN (${inList})
   ORDER BY o.close_date, o.revision;`);
console.table(ob);

// ── (b) daily_closings timeline: closed_at vs updated_at vs 구성분 ───────────────
console.log('\n── (b) daily_closings: status/rev + closed_at vs updated_at + sys_total(구성분) vs actual ──');
const dc = await rows(`
  SELECT dc.close_date::text AS close_date, dc.status, dc.revision,
         to_char(dc.closed_at  AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS closed_kst,
         to_char(dc.updated_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS updated_kst,
         (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
         +COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
         +COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS sys_total,
         (COALESCE(dc.actual_card_total,0)+COALESCE(dc.actual_cash_total,0)
         +COALESCE(dc.actual_transfer_total,0)) AS actual_total
    FROM public.daily_closings dc
    JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE c.slug = '${SLUG}' AND dc.close_date IN (${inList})
   ORDER BY dc.close_date;`);
console.table(dc);

// ── (b2) 각 일자: outbox.created_at 가 dc.closed_at 보다 앞서는지 / 그 사이 매출등재 ──
console.log('\n── (b2) emit(created) vs dc.closed vs 실 payments 최초·최종 등재시각 (drift window) ──');
const drift = await rows(`
  WITH ob AS (
    SELECT o.close_date, min(o.created_at) AS first_emit
      FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id=o.clinic_id
     WHERE c.slug='${SLUG}' AND o.close_date IN (${inList}) GROUP BY o.close_date),
  pay AS (
    SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d,
           min(p.created_at) AS first_pay, max(p.created_at) AS last_pay, count(*) AS n
      FROM public.payments p
      LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
     WHERE COALESCE(p.clinic_id, ci.clinic_id) = (SELECT id FROM public.clinics WHERE slug='${SLUG}')
       AND p.is_simulation IS NOT TRUE AND p.status IS DISTINCT FROM 'deleted'
       AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date IN (${inList})
     GROUP BY 1)
  SELECT ob.close_date::text AS close_date,
         to_char(ob.first_emit AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS first_emit_kst,
         to_char(pay.first_pay AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS first_pay_kst,
         to_char(pay.last_pay  AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS last_pay_kst,
         pay.n AS n_payments,
         (ob.first_emit < pay.first_pay) AS emit_before_any_pay
    FROM ob LEFT JOIN pay ON pay.d = ob.close_date
   ORDER BY ob.close_date;`);
console.table(drift);

// ── (c) revision cardinality per close_date (재emit 부재 = 단일 rev0 고착) ────────
console.log('\n── (c) revision cardinality per close_date (재emit 있었으면 rev≥1 존재) ──');
const card = await rows(`
  SELECT o.close_date::text AS close_date, count(*) AS n_rows,
         max(o.revision) AS max_rev, min(o.revision) AS min_rev,
         bool_or(o.superseded) AS any_superseded
    FROM public.closing_confirmed_outbox o JOIN public.clinics c ON c.id=o.clinic_id
   WHERE c.slug='${SLUG}' AND o.close_date IN (${inList})
   GROUP BY o.close_date ORDER BY o.close_date;`);
console.table(card);

// ── (c2) enqueue 트리거 정의 확인 (AFTER INSERT/UPDATE, entering-closed 조건) ────
console.log('\n── (c2) trg on daily_closings (재emit 트리거 부재 확인) ──');
const trg = await rows(`
  SELECT tgname,
         CASE tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
         (tgtype & 4 > 0) AS on_insert, (tgtype & 16 > 0) AS on_update, (tgtype & 8 > 0) AS on_delete,
         p.proname AS fn
    FROM pg_trigger t
    JOIN pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE rel.relname = 'daily_closings' AND NOT t.tgisinternal
   ORDER BY tgname;`);
console.table(trg);

// ── (c3) enqueue 함수 body 에서 'entering_closed' 게이트 문구 확인 ────────────────
console.log('\n── (c3) enqueue_closing_confirmed 게이트 로직 (entering-closed only?) ──');
const fn = await rows(`
  SELECT (position('v_entering_closed' in prosrc) > 0) AS has_entering_gate,
         (position('IF NOT v_entering_closed THEN' in prosrc) > 0) AS returns_early_if_not_closed,
         (position('closing_source_split' in prosrc) > 0) AS calls_source_split
    FROM pg_proc WHERE proname = 'enqueue_closing_confirmed';`);
console.table(fn);

console.log('\n════════════════════════════════════════════════════════════');
console.log('RC 판정 힌트:');
console.log('  · (a) created_hhmm ≈ 00:xx & memo=CF-5 → 자정 자동마감 발화 가설 지지 / 아니면 반증(수동/외부 프로세스)');
console.log('  · (b2) emit_before_any_pay=true & sys_total(=payload total) << actual/후속 → emit-前 구성분 각인 후 drift');
console.log('  · (c) 각 발산일 max_rev=0 & n_rows=1 → 재emit 트리거 부재(단일 rev0 고착) 확정');
console.log('════════════════════════════════════════════════════════════');
