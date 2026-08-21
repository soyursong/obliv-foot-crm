-- ============================================================
-- ROLLBACK: T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD
-- 진단서 섹션에서 [내성발톱](key='ingrown_toenail') 옵션 1건 제거(seed 원복).
-- 무DDL(JSONB 데이터 UPDATE만). 기존 다른 옵션/섹션 무영향.
-- ============================================================
BEGIN;

DO $rollback$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8'; -- 오블리브 풋센터 종로
BEGIN
  UPDATE form_templates
     SET field_map = jsonb_set(
           field_map,
           '{sections,0,options}',
           (
             SELECT COALESCE(jsonb_agg(opt), '[]'::jsonb)
               FROM jsonb_array_elements(field_map->'sections'->0->'options') AS opt
              WHERE opt->>'key' <> 'ingrown_toenail'
           ),
           false
         )
   WHERE clinic_id = v_clinic
     AND form_key  = 'opinion_doc'
     AND field_map->'sections'->0->>'title' = '진단서'
     AND (field_map->'sections'->0->'options' @> jsonb_build_array(jsonb_build_object('key','ingrown_toenail')));
END
$rollback$;

COMMIT;
