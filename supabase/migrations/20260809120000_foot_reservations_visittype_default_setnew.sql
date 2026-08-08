-- T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE (a) — reservations.visit_type DEFAULT 'returning'→'new'
--   부모 census T-20260808-cross-crm-VISITTYPE-DEFAULT-CROSSFORK-CENSUS(3/3 완료) 결과, foot
--   reservations.visit_type 에 상속 outlier DEFAULT 'returning'::text 실재(AC1 YES, pg_attrdef 실측).
--   foot = LIVE fork(body 의 ancestor): EF reservation-ingest-from-dopamine index.ts:776 bare INSERT
--     1경로에서 slotType falsy 시 visit_type OMIT → DB DEFAULT 'returning' 착지 = DEFAULT reachable(LIVE).
--   AC3 오염 0(dopamine 예약 중 returning-as-first-visit 0건 · 런타임 near-inert), 잔존 P2 hazard.
--
-- change-class = metadata-only 非파괴 DDL (ALTER COLUMN SET DEFAULT).
--   · table rewrite 0 · row mutation 0 · reversible.
--   · DA CONSULT-REPLY GO(조건부) — MSG-20260809-080318-6oor(consult a7lx 회신).
--   · §3.1(b) 파괴열거 미해당 → CEO 파괴게이트 면제(YES).
--   · LIVE fork 이므로 (a) = load-bearing safety floor(defense-in-depth 아님).
--
-- doctrine: monotone-OR floor — 'new'=floor(fail-safe) · 'returning'=승격상태 · 미지정(bare)→floor 착지.
--   상속된 'returning' default 는 bare INSERT 시 재진(승격상태)을 무근거 선착지시키는 fail-open outlier.
--   'new'(초진 floor)로 정렬 = fail-safe.
--
-- belt-and-suspenders: (a) 본 DDL(bare 착지값 'new'화) + (b) EF harden(index.ts:776 → visitTypeMapped
--   명시 착지, DEFAULT unreachable화). 둘 다 필수(canonical). (b) = 동 commit EF diff.
--
-- 하드 스코프 가드:
--   · schema DEFAULT 축(forward)만. stored-row 정정/backfill 없음(VG3 재검증 = landed 0 — 정정 대상 부재,
--     forward-only latent seal). >0 이었으면 별 backfill leg(별건 발번), 본 티켓 fold 금지.
--   · SET DEFAULT 외 DDL(DROP/타입변경/CHECK 변경) 없음.
--   · CHECK 3-type[new,returning,experience] 'new' 포함(prod 실측 확인) → SET DEFAULT 'new' 통과 보장(VG2).
--
-- 멱등: 현재 default 확인 후 'new' 아닐 때만 SET (재실행 안전 · no-op 시 NOTICE).
-- 롤백: 20260809120000_foot_reservations_visittype_default_setnew.rollback.sql (SET DEFAULT 'returning' + EF revert=VG5)
-- 무영속 dry-run: 20260809120000_foot_reservations_visittype_default_setnew.dryrun.sql
--                 (러너: db-gate/T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE_dryrun.mjs)
-- ⚠ prod apply = supervisor DB-GATE(dev prod SERVICE_ROLE 미보유). applied_at 은 GO-token 후 기입.

BEGIN;

DO $$
DECLARE
  v_cur text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_cur
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname = 'reservations' AND a.attname = 'visit_type';

  IF v_cur IS NULL OR v_cur !~ '^''new''' THEN
    ALTER TABLE public.reservations ALTER COLUMN visit_type SET DEFAULT 'new';
    RAISE NOTICE 'VISITTYPE_DEFAULT_SETNEW: reservations.visit_type DEFAULT % -> ''new''::text 적용', COALESCE(v_cur, 'NULL');
  ELSE
    RAISE NOTICE 'VISITTYPE_DEFAULT_SETNEW: reservations.visit_type DEFAULT 이미 % (멱등 no-op)', v_cur;
  END IF;
END $$;

COMMIT;
