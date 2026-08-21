-- ============================================================
-- T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD
-- 2번차트 소견서/진단서 발행요청 옵션 그리드 [진단서] 섹션에 [내성발톱] 옵션 1건 ADDITIVE 추가.
-- ADDITIVE · db_change:false · 무DDL(순수 데이터 seed, JSONB 데이터 UPDATE)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260821170000_foot_opinion_doc_add_ingrown_toenail.rollback.sql
-- 작성: dev-foot / 2026-08-21
-- ============================================================
-- 요청: 김주연 총괄(#foot C0ATE5P6JTH, thread 1787283664.810469).
-- 컨펌: 문지은 대표원장(U0ALGAAAJAV, MSG-20260821-221354-5jia) — §11.1 medical_confirm_gate 통과.
--   (1) 배치 섹션 = [진단서](단일배타 select).
--   (2) phrase = 원장 제공 verbatim(의료법§22 immutable·dev 임의창작/수정/요약/경어체보정 금지).
--   (3) phrase 내 `[내원일]` 토큰 = 기존 서류날짜(docDate=최근 방문일) 자동치환 로직 그대로
--       (FE substituteDatePlaceholder 가 `[날짜]` 와 동형 처리, 발행일=오늘 아님).
--
-- SSOT: '발행요청 항목목록' 옵션 그리드 = form_templates(clinic=풋센터종로, form_key='opinion_doc')
--       .field_map.sections (JSONB, prod authoritative). FE OPINION_SECTIONS 는 empty-safe 폴백일 뿐.
--       seed 원본 = 20260616160000_opinion_doc_form_stack.sql (진단서 = sections[0]).
--
-- 멱등: 이미 key='ingrown_toenail' 존재 시 no-op(WHERE NOT ... @> 가드). 재실행 안전.
-- 무접촉: 기존 옵션/섹션/타 데이터 무변경(진단서 options 배열에 1건 append only).
-- ⚠ DDL 없음(테이블/컬럼/enum 무변경) → db_change:false, DA CONSULT 불요, DB-GATE GO-token 대상 아님.
-- ============================================================

BEGIN;

DO $seed$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8'; -- 오블리브 풋센터 종로
  v_new_opt jsonb := jsonb_build_object(
    'key', 'ingrown_toenail',
    'label', '내성발톱',
    'phrase', '상기환자는 상기증상 및 병명으로 [내원일]에 내원하였고 양측 내향성 발톱 및 염증소견으로 내원하신 분으로, 소염제·항생제 등의 약물 치료와 병행하여 발톱의 만곡을 바로잡기 위한 의료진의 내성발톱 치료 의료기기를 부착·조정하는 처치가 필요하여 치료 들어감. 발톱이 새로 자라는 속도에 맞추어 반복적인 부착·조정이 요구되어, 향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.'
  );
BEGIN
  -- 진단서 섹션(sections[0]) options 배열 끝에 append. 구조 가드:
  --   sections[0].title='진단서' 이고, ingrown_toenail 키 미존재일 때만 UPDATE(멱등·오배치 방지).
  UPDATE form_templates
     SET field_map = jsonb_set(
           field_map,
           '{sections,0,options}',
           (field_map->'sections'->0->'options') || jsonb_build_array(v_new_opt),
           false
         )
   WHERE clinic_id = v_clinic
     AND form_key  = 'opinion_doc'
     AND field_map->'sections'->0->>'title' = '진단서'
     AND NOT (field_map->'sections'->0->'options' @> jsonb_build_array(jsonb_build_object('key','ingrown_toenail')));
END
$seed$;

-- 검증(supervisor DDL-diff self-check): 진단서 섹션에 내성발톱 옵션 1건 실재 + phrase verbatim.
DO $verify$
DECLARE
  v_phrase text;
BEGIN
  SELECT (opt->>'phrase') INTO v_phrase
    FROM form_templates ft,
         LATERAL jsonb_array_elements(ft.field_map->'sections'->0->'options') AS opt
   WHERE ft.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND ft.form_key  = 'opinion_doc'
     AND opt->>'key'  = 'ingrown_toenail'
   LIMIT 1;

  IF v_phrase IS NULL THEN
    RAISE EXCEPTION 'INGROWN-TOENAIL seed 실패: 진단서 섹션에 ingrown_toenail 옵션 미존재';
  END IF;
  IF position('[내원일]' IN v_phrase) = 0 THEN
    RAISE EXCEPTION 'INGROWN-TOENAIL seed 실패: phrase 에 [내원일] 토큰 미존재(verbatim 훼손)';
  END IF;
  RAISE NOTICE 'T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD: 진단서 섹션 내성발톱 옵션 seed 검증 통과';
END
$verify$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor DDL-diff)
-- ============================================================
-- [ ] ① 파괴 0     : DDL 없음. form_templates(opinion_doc) field_map JSONB 데이터 UPDATE(진단서 options append 1건)만.
-- [ ] ② 멱등       : 재실행 시 @> 가드로 no-op(중복 append 없음).
-- [ ] ③ 오배치 방지 : sections[0].title='진단서' 가드 — 구조 상이 시 UPDATE no-op(안전 실패).
-- [ ] ④ verbatim   : phrase = 원장 제공 원문 그대로([내원일] 토큰 보존, 의료법§22).
-- [ ] ⑤ FE parity  : OPINION_SECTIONS(폴백) 진단서 섹션 phrase 와 byte-identical.
-- ============================================================
