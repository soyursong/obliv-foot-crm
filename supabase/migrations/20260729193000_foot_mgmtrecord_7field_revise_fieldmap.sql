-- T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2
-- 초진 관리기록지 form_templates.field_map ADDITIVE 갱신 (무DDL — 순수 데이터 UPDATE).
--
-- 배경: base(T-20260728-DOCFORM-FIRSTVISIT-MGMTRECORD, deployed) 양식의 현장 실사용 후 7건 개편.
--   본 마이그레이션은 그 중 자유텍스트 field_map 정리(항목② ③ 제거분)만 반영한다.
--   제거: nail_status(발톱 상태)·other_check(기타 확인 사항)·care_other_text(초기관리 기타)·care_plan(관리 계획).
--   유지: patient_*·visit_date·vp_other_text·symptom_history·skin_status·remarks·issue_date·clinic_name·doctor_name.
--   신규(시술및처방·상병명·증상경과)는 DocumentPrintPanel 전용 블록(드롭다운/상용구)에서 처리 → field_map 미포함
--     (텍스트 input 중복 노출 방지, manualValues/allValues 로 인쇄·persist). HTML 템플릿(FIRST_VISIT_MGMT_RECORD_HTML)은 코드 배포.
-- 성격: ADDITIVE only. 스키마 무변경(신규 컬럼/테이블/enum 없음) → db_change=false 유지, MIG-GATE/DA-CONSULT 비대상.
-- 멱등: 동일 field_map 로 반복 UPDATE 시 no-op(값 동일). 대상 없으면 0행(무해).
-- 롤백: 20260729193000_..._fieldmap.rollback.sql (base 15-entry field_map 복원).

UPDATE form_templates
SET field_map = '[
    {"key":"patient_name","label":"성명","type":"text","x":0,"y":0},
    {"key":"patient_birthdate","label":"생년월일","type":"text","x":0,"y":0},
    {"key":"patient_phone","label":"연락처","type":"text","x":0,"y":0},
    {"key":"visit_date","label":"초진일","type":"date","x":0,"y":0},
    {"key":"vp_other_text","label":"방문목적 기타","type":"text","x":0,"y":0},
    {"key":"symptom_history","label":"증상 발생 경위","type":"multiline","x":0,"y":0,"w":400,"h":60},
    {"key":"skin_status","label":"피부 상태","type":"multiline","x":0,"y":0,"w":400,"h":40},
    {"key":"remarks","label":"특이사항","type":"multiline","x":0,"y":0,"w":400,"h":60},
    {"key":"issue_date","label":"발급일","type":"date","x":0,"y":0},
    {"key":"clinic_name","label":"센터명","type":"text","x":0,"y":0},
    {"key":"doctor_name","label":"담당자","type":"text","x":0,"y":0}
  ]'::jsonb
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND form_key = 'first_visit_mgmt_record';
