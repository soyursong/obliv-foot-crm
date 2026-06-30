-- ════════════════════════════════════════════════════════════════════════════
-- T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT — 진료확인서 발급폼 2개 분리 (방식 β)
--
-- ★ 양 게이트 GO (planner MSG-20260630-124723-qn24):
--   · 게이트 A(reporter): 김주연 총괄 옵션② 직접 확정 — '코드·진단명 포함'/'불포함' 2버튼=2발급폼.
--   · 게이트 B(DA CONSULT-REPLY MSG-20260630-124429-aw11): GO, 방식 β. 비파괴 → 대표 게이트 면제(autonomy §3.1).
--   · 부모 슬라이스(RELABEL, MSG-20260630-123516-vsyz §2)가 bridge=(α)defer → 본 슬라이스로 이관.
--
-- ★ 라이브 실측 (2026-06-30, Management API · read-only) ─ 착수 선결 self-check 2건:
--   ① 패널 active 필터: 풋 패널은 form_templates.active=true 쿼리(PaymentMiniWindow:772 / DocumentPrintPanel:454)
--      + 코드측 화이트리스트 DOCLIST_ORDER_10(formTemplates.ts) 두 관문. 별도 DB HIDDEN_FORM_KEYS 상수 없음.
--      → 레거시 'treat_confirm' 은 (a) DB active=false (b) DOCLIST_ORDER_10 에서 제거 두 경로로 패널 미노출(3중표시 차단).
--      → 신규 'treat_confirm_code'/'treat_confirm_nocode' 은 DOCLIST_ORDER_10 에 추가(동 커밋 FE)로 노출.
--   ② service_id 컬럼 기존재: information_schema 확인 = 존재(Migration A 20260629210000 적용). DDL 0 전제 충족.
--
-- ★ 비파괴/forward-only 가드 (핵심):
--   · service_charges 무변경 = 폼 발행은 service_charges 를 읽기(snapshot)만. 본 마이그 service_charges INS/UPD/DEL = 0건.
--   · 레거시 'treat_confirm' = DELETE 금지 → active=false 토글만(forward-only). 기존 발행문서(form_submissions 10건)·
--     참조 무결성·스냅샷 보존. HTML_TEMPLATE_MAP.treat_confirm 도 코드측 보존(재출력 무손상).
--   · 신규 2행 = ADDITIVE INSERT. service_id bridge = 라이브 SKU id 직접 지정(RELABEL 동일 2 SKU, id 불변):
--       treat_confirm_code   → b590d457-0834-44d6-805a-6c8f7c0e8672 (진료확인서1, 10,000, code·진단명 포함)
--       treat_confirm_nocode → 67ce0da3-3d85-42cf-9589-4176efdc0536 (진료확인서2,  3,000, code·진단명 불포함)
--   · out-of-scope C5900004(진료확인서·3,000·'기본') = 무접촉.
--   · 서류종류 1개 유지 = code/nocode 동일 서류종류(진료확인서) 표시변이 → doc-serial prefix 둘 다 VC 공유(docSerial.ts).
--     11번째 서류종류 신설·발번 분기 없음.
--
-- 멱등: INSERT … WHERE NOT EXISTS / active 토글 가드 → 재실행 안전.
-- rollback: 20260630160000_foot_docconfirm_formpanel_split.rollback.sql (active-토글, seed DELETE는 발행이력 0건시만)
-- 적용: node scripts/apply_20260630160000_foot_docconfirm_formpanel_split.mjs (preflight 실측대조 내장)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 신규 발급폼 INSERT — treat_confirm_code (코드·진단명 포함, service_id→진료확인서1) ──
INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko, template_path, template_format,
  field_map, requires_signature, required_role, active, sort_order, service_id
)
SELECT
  '74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'treat_confirm_code',
  '진료확인서(코드·진단명 포함)', '', 'html',
  '[
    {"key":"patient_name",   "label":"환자성명",     "type":"text", "x":0,"y":0},
    {"key":"patient_rrn",    "label":"주민번호",     "type":"text", "x":0,"y":0},
    {"key":"patient_address","label":"주소",         "type":"text", "x":0,"y":0},
    {"key":"visit_date",     "label":"진료일",       "type":"date", "x":0,"y":0},
    {"key":"issue_date",     "label":"발행일",       "type":"date", "x":0,"y":0},
    {"key":"clinic_name",    "label":"의료기관",     "type":"text", "x":0,"y":0},
    {"key":"clinic_address", "label":"주소",         "type":"text", "x":0,"y":0},
    {"key":"clinic_phone",   "label":"전화 및 팩스", "type":"text", "x":0,"y":0},
    {"key":"doctor_name",    "label":"의사성명",     "type":"text", "x":0,"y":0}
  ]'::jsonb,
  false, 'admin|manager|coordinator', true, 40,
  'b590d457-0834-44d6-805a-6c8f7c0e8672'
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates
   WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND form_key = 'treat_confirm_code'
);

-- ── 2. 신규 발급폼 INSERT — treat_confirm_nocode (코드·진단명 불포함, service_id→진료확인서2) ──
INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko, template_path, template_format,
  field_map, requires_signature, required_role, active, sort_order, service_id
)
SELECT
  '74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'treat_confirm_nocode',
  '진료확인서(코드·진단명 불포함)', '', 'html',
  '[
    {"key":"patient_name",   "label":"환자성명",     "type":"text", "x":0,"y":0},
    {"key":"patient_rrn",    "label":"주민번호",     "type":"text", "x":0,"y":0},
    {"key":"patient_address","label":"주소",         "type":"text", "x":0,"y":0},
    {"key":"visit_date",     "label":"진료일",       "type":"date", "x":0,"y":0},
    {"key":"issue_date",     "label":"발행일",       "type":"date", "x":0,"y":0},
    {"key":"clinic_name",    "label":"의료기관",     "type":"text", "x":0,"y":0},
    {"key":"clinic_address", "label":"주소",         "type":"text", "x":0,"y":0},
    {"key":"clinic_phone",   "label":"전화 및 팩스", "type":"text", "x":0,"y":0},
    {"key":"doctor_name",    "label":"의사성명",     "type":"text", "x":0,"y":0}
  ]'::jsonb,
  false, 'admin|manager|coordinator', true, 41,
  '67ce0da3-3d85-42cf-9589-4176efdc0536'
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates
   WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND form_key = 'treat_confirm_nocode'
);

-- ── 3. 레거시 단일행 deactivate (forward-only, DELETE 금지) ──────────────────────────────
--  과거 발행문서(form_submissions 10건)·참조 무결성·스냅샷 보존. active 토글만.
UPDATE form_templates
   SET active = false
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND form_key = 'treat_confirm'
   AND service_id IS NULL
   AND active = true;  -- 멱등 가드(이미 false면 0행 no-op)

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인):
--   SELECT form_key, active, service_id FROM form_templates
--     WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' AND form_key LIKE 'treat_confirm%' ORDER BY form_key;
--   기대: treat_confirm(active=f, service_id=NULL) / treat_confirm_code(active=t, service_id=b590d457) /
--         treat_confirm_nocode(active=t, service_id=67ce0da3)
--   service_charges 무변경: 본 마이그 service_charges 대상 INSERT/UPDATE/DELETE = 0건.
