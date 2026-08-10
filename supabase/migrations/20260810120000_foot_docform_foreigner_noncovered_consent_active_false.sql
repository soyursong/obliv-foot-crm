-- T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-REPLACE (SPEC-CORRECTION / MOVE)
-- 외국인 비급여 진료 동의서 form_templates seed row 비활성화 (active=false, 무DDL — 순수 UPDATE).
--
-- 배경: 구 T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM 이 이 동의서를 '서류 발행 화면'
--   (DocumentPrintPanel)에 올린 것은 오배치. canonical 위치 = 펜차트 양식 탭(PenChartTab, A4 손서명·
--   2-layer 합성 저장). 서류 발행 화면에서는 비활성 de-list.
-- 정합(AC4): (a) form_templates 행 active=false [본 마이그] + (b) DOCLIST_ORDER_10/'동의서' 그룹
--   de-list [코드, formTemplates.ts] — 둘 다 정합.
-- 성격: 비파괴 UPDATE(active 플래그만). hard-DELETE 지양(reversible). 스키마 무변경(신규 컬럼/테이블/enum 0) → 파괴 0.
--   발행 이력(form_submissions)은 별 테이블 무접촉. HTML 템플릿(HTML_TEMPLATE_MAP)·FORM_META 는 펜차트 렌더용으로 보존.
-- 멱등: 이미 active=false 면 no-op(WHERE active). 재실행 안전.
-- 롤백: 20260810120000_..._active_false.rollback.sql (active=true 복원).
-- dry-run: 20260810120000_..._active_false.dryrun.sql (무영속 ROW_COUNT 계측).

UPDATE form_templates
SET active = false
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND form_key = 'foreigner_noncovered_consent'
  AND active = true;
