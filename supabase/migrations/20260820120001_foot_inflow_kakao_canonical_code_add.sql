-- T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD  (dev-foot)
-- 유입경로 canonical 신규코드 inbound.kakao 추가 — 풋센터(obliv-foot-crm)
-- assignee: dev-foot | db_change: true | 순수 ADDITIVE (system_codes INSERT 1행 · 기존 11코드 무변)
-- 2026-08-19
--
-- ★ 착수/판정 GATE: DA CONSULT-REPLY GO (MSG-20260819-120836-9pqg)
--     verdict = Q1(a) 신규 canonical 코드 inbound.kakao **ADDITIVE CONDITIONAL-GO**
--               (kakao = 진성 distinct 1급 inbound 채널 · naver_place/homepage peer).
--     SSOT = da_decision_foot_inflow_kakao_canonical_code_add_20260819.md.
--     Q1(b) display-variant(inbound.etc + source_ref 자유텍스트 파싱 집계) = REJECT-as-default.
--     Q2 re-map = forward-only (default) · historical backfill = DECOUPLED 별건 SOP.
--     Q3 cross-CRM = foot-only overlay (5-CRM blind 횡전개 금지 · 본 마이그는 foot DB 단독 착지).
--
-- ⚠ apply GATE (AC-2, DDL-0 carve 금지):
--     DDL 없어도 system_codes = cross-CRM SSOT data-write → supervisor DB-GATE(seed diff + 롤백) +
--     물리 GO-token 선행 필수. GO-token 前 prod seed 선-write 금지(apply_before_go 클래스).
--     apply-gate = supervisor (NOT DA). DA GO = change-class/축 판정만.
--     co-deploy 원자: 본 seed(system_codes INSERT) + code_availability overlay(default-available) + FE 옵션 동시 배포.
--       (FE 옵션 = 데이터구동: get_inflow_channels RPC 가 system_codes 를 그대로 서빙 → seed 착지 = 드롭다운 즉시 노출.
--        별도 FE 하드코딩 목록 없음. crosswalk advisory 힌트만 co-deploy.)
--
-- 순수 ADDITIVE 근거 (회귀 0 · backfill 0 · 순소실 0):
--   ① system_codes INSERT 1행(inbound.kakao)만. 기존 11코드 DROP/rename/semantic/sort_order UPDATE 0.
--   ② forward-only: 기존 행(inbound.etc + source_ref='카카오톡') 소급 UPDATE 없음. 과거건은 그대로 유지.
--       historical 재분류(inbound.etc ∧ source_ref='카카오톡' → inbound.kakao) = 별건 Cross-CRM Data-Correction SOP.
--   ③ §36 방화벽 NEUTRAL: series=inbound(capture axis only). referral_source(§36-3 FREEZE) 무접촉 ·
--       source_system 무결속 · visit_route(legacy) 무접촉. TM = 배정 enum 축 잔류(inflow 축 주입 금지).
--   ④ foot-only: 본 마이그는 foot DB 단독 착지 → canonical 코드는 foot 에만 존재. 타 CRM 확산 = 별건 §36 extension.
--   ⑤ availability = foot overlay(default-available): code_availability 에 is_available=false 행 미삽입 →
--       foot 전 clinic 노출(기존 11코드 동일 패턴). 숨김이 필요한 특정 clinic 은 별도 overlay 행으로 제어.
--   ⑥ 멱등: INSERT ... ON CONFLICT (code_type, code) DO NOTHING (재실행 안전).
--
-- ★ sort_order = 3 (기존 inbound.homepage 와 공유): system_codes/RPC 의 ORDER BY = (sort_order, code).
--     code-tiebreak 로 'inbound.homepage'(3) → 'inbound.kakao'(3) 순서 → kakao 를 inbound 사회채널 그룹 내
--     homepage 직후에 peer 배치(DA 'naver_place/homepage peer' 의도 충족)하면서 기존 행 sort_order UPDATE 0 유지.
--     (0~10 정수 gap 부재 → fractional 대신 tie-break 로 peer 배치 · 순수 INSERT-only 보존.)
--
-- 선례 동형: 20260801230000_foot_inflow_channel_intake_lane.sql (11코드 최초 시드).
-- 롤백: 20260820120001_foot_inflow_kakao_canonical_code_add.rollback.sql (inbound.kakao 1행 DELETE).
-- 적용 방법 (supervisor DB-GATE + GO-token 후):
--   supabase db push --file supabase/migrations/20260820120001_foot_inflow_kakao_canonical_code_add.sql
-- =====================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- system_codes SSOT — inbound.kakao 1행 INSERT (순수 ADDITIVE · 멱등)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO public.system_codes (code_type, code, label, series, sort_order, requires_reason)
VALUES
  ('inflow_channel', 'inbound.kakao', '카톡', 'inbound', 3, false)
ON CONFLICT (code_type, code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- 검증: inbound.kakao 시드 착지 + 기존 11코드 존치(총 12행) + 기존 행 무변
-- ════════════════════════════════════════════════════════════════════
DO $chk$
DECLARE
  v_total   integer;
  v_kakao   integer;
  v_etc_rr  boolean;
BEGIN
  SELECT count(*) INTO v_total  FROM public.system_codes WHERE code_type = 'inflow_channel';
  SELECT count(*) INTO v_kakao  FROM public.system_codes WHERE code_type = 'inflow_channel' AND code = 'inbound.kakao';
  SELECT requires_reason INTO v_etc_rr FROM public.system_codes WHERE code_type = 'inflow_channel' AND code = 'inbound.etc';

  IF v_kakao <> 1 THEN
    RAISE EXCEPTION 'inbound.kakao 시드 착지 실패(count=%)', v_kakao;
  END IF;
  IF v_total < 12 THEN
    RAISE EXCEPTION 'inflow_channel 코드 총계 이상(기대 >=12, 실제=%) — 기존 11코드 유실 의심', v_total;
  END IF;
  -- 기존 inbound.etc(사유 필수) 무변 방어 확인 (semantic 변경 0)
  IF v_etc_rr IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'inbound.etc.requires_reason 무변 가드 실패(기대 true, 실제=%)', v_etc_rr;
  END IF;
END $chk$;

-- PostgREST 스키마 캐시 새로고침 (신규 코드 즉시 서빙)
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor DB-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════
-- 시드 착지:
--   SELECT count(*) FROM public.system_codes WHERE code_type='inflow_channel';                  -- 기대: 12
--   SELECT code,label,series,sort_order,requires_reason FROM public.system_codes
--     WHERE code_type='inflow_channel' AND code='inbound.kakao';                                -- 기대: 카톡/inbound/3/false
-- RPC (foot clinic, overlay 무설정 → 12행, kakao 는 homepage 직후):
--   SELECT code,label FROM public.get_inflow_channels((SELECT id FROM public.clinics LIMIT 1)); -- 기대: 12행 포함 inbound.kakao
-- 기존 11코드 무변(회귀 가드):
--   SELECT count(*) FROM public.system_codes WHERE code_type='inflow_channel' AND code<>'inbound.kakao'; -- 기대: 11
