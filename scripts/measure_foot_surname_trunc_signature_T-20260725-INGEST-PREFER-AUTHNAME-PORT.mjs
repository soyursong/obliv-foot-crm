/**
 * PHASE 1 READ-ONLY MEASUREMENT — 성씨-절삭 signature 노출 규모 실측 (foot prod)
 * ticket: T-20260725-foot-INGEST-PREFER-AUTHNAME-PORT (P2, INFO 게이트 실측)
 * intent: scalp2 proven preferAuthoritativeName(auth.endsWith(snap) && auth.len>snap.len)
 *         signature 를 foot 의 denorm 스냅샷(reservations.customer_name / check_ins.customer_name)에
 *         대해 순수 read-only 로 실측한다. 0건이면 evidence 첨부 no-op close, 유의미하면 Phase2 이식.
 * method: Supabase Management API /database/query (SUPABASE_ACCESS_TOKEN, account PAT). SELECT-only.
 * NOTE:   어떤 write/DDL 도 실행하지 않음. 판정근거 스냅샷 목적.
 *
 * foot 아키텍처 주의(형제 body 와 다름): reservations INSERT(신규 예약) 경로는
 *   reservation-ingest-from-dopamine/index.ts:720 에서 customer_name: name (payload 직착) 으로 채운다
 *   → scalp2 와 동일한 '직착' 구조(RPC customers.name lookup 아님). 단 cancel/reschedule 은 RPC
 *   upsert_reservation_from_source 경로. 따라서 signature 실측이 no-op 판정의 유일 근거.
 *   유일 무-auth 경로 = 동행행(customer_id NULL) → auth 부재로 signature 판정 불가, 규모만 별도 집계.
 *   추가 방어: customers.name 은 NFC 정규화(NAME-NFD-NFC-BACKFILL) + never-downgrade/preserve-on-NULL.
 */
const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN env 없음'); process.exit(2); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// 성씨-절삭 signature (scalp2 proven): auth.endsWith(snap) && length(auth) > length(snap) && auth != snap
// SQL: right(auth, len(snap)) = snap  (endsWith), length gt, trim 양측.
const sigPredicate = (authCol, snapCol) => `
     ${snapCol} IS NOT NULL AND btrim(${snapCol}) <> ''
 AND ${authCol} IS NOT NULL AND btrim(${authCol}) <> ''
 AND btrim(${authCol}) <> btrim(${snapCol})
 AND length(btrim(${authCol})) > length(btrim(${snapCol}))
 AND right(btrim(${authCol}), length(btrim(${snapCol}))) = btrim(${snapCol})`;

const out = { ticket: 'T-20260725-foot-INGEST-PREFER-AUTHNAME-PORT', phase: 'P1-readonly-measure', ref: REF };

// ── 0) 컬럼 실재 확인 (reservations / check_ins 스키마 방어) ──
out.reservations_cols = (await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='reservations'
  AND column_name IN ('customer_id','customer_name','source_system','reservation_date','is_companion') ORDER BY column_name;`)).map(r => r.column_name);
const colsCk = (await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='check_ins'
  AND column_name IN ('customer_id','customer_name') ORDER BY column_name;`)).map(r => r.column_name);
out.check_ins_cols = colsCk;

const hasCompanion = out.reservations_cols.includes('is_companion');

// ── 1) reservations 분모 ──
out.reservations_totals = (await q(`SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE source_system='dopamine')::int AS dopamine,
    count(*) FILTER (WHERE customer_id IS NOT NULL AND btrim(coalesce(customer_name,''))<>'')::int AS linked_with_snap
    ${hasCompanion ? `, count(*) FILTER (WHERE is_companion IS TRUE)::int AS companion` : ''}
  FROM public.reservations;`))[0];

// ── 2) reservations 성씨-절삭 signature (linked = customer_id NOT NULL) ──
out.reservations_signature_count = (await q(`SELECT count(*)::int AS n
  FROM public.reservations r JOIN public.customers c ON c.id = r.customer_id
  WHERE ${sigPredicate('c.name', 'r.customer_name')};`))[0].n;

out.reservations_signature_sample = await q(`SELECT r.id, r.customer_name AS snap, c.name AS auth,
    r.source_system, r.reservation_date${hasCompanion ? ', r.is_companion' : ''}
  FROM public.reservations r JOIN public.customers c ON c.id = r.customer_id
  WHERE ${sigPredicate('c.name', 'r.customer_name')}
  ORDER BY r.reservation_date DESC NULLS LAST LIMIT 30;`);

// ── 3) 동행행(customer_id NULL, payload 직착) — auth 부재 → signature 판정 불가, 규모만 집계 ──
out.companion_snap_count = (await q(`SELECT count(*)::int AS n FROM public.reservations
  WHERE (${hasCompanion ? 'is_companion IS TRUE OR ' : ''}customer_id IS NULL) AND btrim(coalesce(customer_name,''))<>'';`))[0].n;

// ── 4) check_ins 성씨-절삭 signature (customer_id 링크 존재 시) ──
if (colsCk.includes('customer_id') && colsCk.includes('customer_name')) {
  out.check_ins_totals = (await q(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE customer_id IS NOT NULL AND btrim(coalesce(customer_name,''))<>'')::int AS linked_with_snap
    FROM public.check_ins;`))[0];
  out.check_ins_signature_count = (await q(`SELECT count(*)::int AS n
    FROM public.check_ins ci JOIN public.customers c ON c.id = ci.customer_id
    WHERE ${sigPredicate('c.name', 'ci.customer_name')};`))[0].n;
  out.check_ins_signature_sample = await q(`SELECT ci.id, ci.customer_name AS snap, c.name AS auth,
      ci.created_at
    FROM public.check_ins ci JOIN public.customers c ON c.id = ci.customer_id
    WHERE ${sigPredicate('c.name', 'ci.customer_name')}
    ORDER BY ci.created_at DESC NULLS LAST LIMIT 30;`);
} else {
  out.check_ins_note = 'check_ins 에 customer_id/customer_name 컬럼 부재 → signature 판정 스킵';
}

console.log(JSON.stringify(out, null, 2));
