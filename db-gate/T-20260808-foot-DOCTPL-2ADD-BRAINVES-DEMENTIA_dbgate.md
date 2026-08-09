# T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA — DB 게이트 증적 (db_change=false, ADDITIVE 데이터 seed)

- **commit_sha**: 3862bfb3983de18b794fe474baf21b6b76b31270 (on origin/main, ancestor 확인)
- **canonical_repo**: obliv-foot-crm (project rxlomoozakkjesdqjtvd)
- **artifact-class**: db_only (순수 데이터 row INSERT, 무DDL — document_templates 旣존재)
- **change-class**: ADDITIVE (document_templates 신규 1행. 기존 컬럼/테이블/enum 무변경 → §3.1 대표게이트 면제, supervisor DDL-diff도 DDL 없음)
- **e2e_spec_exempt_reason**: db_only

## mig_files
- supabase/migrations/20260808200000_foot_doctpl_seed_brainves.sql (up, INSERT…SELECT WHERE NOT EXISTS 멱등)
- supabase/migrations/20260808200000_foot_doctpl_seed_brainves.rollback.sql (down, DELETE name='뇌혈관약')

## 스키마 검증 (무DDL 근거)
document_templates 컬럼(20260504_doctor_treatment_flow_up.sql CREATE TABLE): id SERIAL PK, document_type TEXT('diagnosis|opinion|prescription|visit_confirmation|general'), name TEXT NOT NULL, content TEXT NOT NULL, is_active BOOL, sort_order INT — 사용 컬럼(document_type/name/content/sort_order/is_active) 전부 旣존재. document_type='opinion'=유효값. 신규 컬럼 0.

## prod 적용 증적 (rxlomoozakkjesdqjtvd)
- BEFORE: `document_templates WHERE name='뇌혈관약'` = 0행 (커밋만 되고 미적용 상태였음)
- APPLY: service_role client INSERT (커밋된 마이그 content 리터럴 verbatim 추출·적용). NOT EXISTS 가드 재확인 후 INSERT.
- AFTER: id=5, document_type='opinion', name='뇌혈관약', sort_order=30, is_active=true
  - content 검증: `^<b>뇌혈관약</b>\n\n▎` 패턴 일치, `[오늘날짜]` placeholder 보존, 말미 "…요함." 일치, len=634
  - 멱등: name='뇌혈관약' row count = 1 (재실행 no-op)

## T2 치매약 — HOLD (본 배포 미포함)
- 원문 truncated("…조기 대처가 지연되어 피"에서 절단) → AC-2대로 전체본문 확보 前 INSERT 금지.
- prod `document_templates WHERE name='치매약'` = 0행 (HOLD 준수 확인).
- 전체본문 확보 시 별도 마이그로 INSERT.

## 육안확인 경로 (db_only)
풋 CRM 로그인 → admin/clinic-management?tab=document_templates → 서류 템플릿 목록 '뇌혈관약' 행 표시 → 선택 시 본문(<b>볼드+▎문단+[오늘날짜]) 렌더/인쇄.

## 게이트
- §11 의료공간(진료대시보드/진료관리 의사전용 화면) 코드 무수정 — 서류 템플릿은 admin/clinic-management 관리 데이터(레지스트리 seed). 의료화면 로직 무접촉.
- AC-3 무접촉: 기존 템플릿 무영향(순수 ADDITIVE). AC-4 db_change:false 유지(무DDL).
