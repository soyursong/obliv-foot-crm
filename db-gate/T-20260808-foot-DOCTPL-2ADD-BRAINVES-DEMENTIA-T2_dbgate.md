# T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA (T2 치매약) — DB 게이트 증적 (db_change=false, ADDITIVE 데이터 seed)

- **canonical_repo**: obliv-foot-crm (project rxlomoozakkjesdqjtvd)
- **artifact-class**: db_only (순수 데이터 row INSERT, 무DDL — document_templates 旣존재)
- **change-class**: ADDITIVE (document_templates 신규 1행. 기존 컬럼/테이블/enum 무변경 → §3.1 대표게이트 면제, DDL 없음 → supervisor DDL-diff N/A)
- **e2e_spec_exempt_reason**: db_only
- **HOLD 해제 근거**: responder TICKET-UPDATE (MSG-20260808-210447-eith, slack ts 1786189940.994679) — 원문 재독 결과 치매약 전체 본문 확보. 기존 "절단" 판단은 오류였고 본문 완결 확인 → HOLD 해제, INSERT 진행.

## mig_files
- supabase/migrations/20260808210000_foot_doctpl_seed_dementia.sql (up, INSERT…SELECT WHERE NOT EXISTS 멱등)
- supabase/migrations/20260808210000_foot_doctpl_seed_dementia.rollback.sql (down, DELETE name='치매약')

## 스키마 검증 (무DDL 근거)
T1과 동일 테이블·컬럼 사용. document_templates(20260504_doctor_treatment_flow_up.sql): document_type TEXT('diagnosis|opinion|prescription|visit_confirmation|general'), name TEXT NOT NULL, content TEXT NOT NULL, is_active BOOL, sort_order INT. 사용 컬럼 전부 旣존재. document_type='opinion'=유효값. 신규 컬럼 0.

## prod 적용 증적 (rxlomoozakkjesdqjtvd, Mgmt API)
- BEFORE: document_templates 1행 (id=5 '뇌혈관약' opinion sort=30). `WHERE name='치매약'` = 0행.
- APPLY: 커밋된 마이그 content 리터럴 verbatim 적용. NOT EXISTS 가드 재확인 후 INSERT (COMMIT).
- AFTER (신규 쿼리, 영속 확인): id=6, document_type='opinion', name='치매약', sort_order=40, is_active=true
  - content 검증: head=`<b>치매약</b>\n\n▎ 상기환자는 `, tail=`추시 및 반복적 보존적 치료를 요함.`, len=640
  - `[오늘날짜]` placeholder 보존 (T1과 동일 발급-시점 자동치환 로직 적용).
  - 멱등: name='치매약' row count = 1 (재실행 no-op).
- counts: total=2, 뇌혈관약=1, 치매약=1.

## 육안확인 경로 (db_only)
풋 CRM 로그인 → admin/clinic-management?tab=document_templates → 서류 템플릿 목록 '뇌혈관약'+'치매약' 2행 표시 → '치매약' 선택 시 본문(<b>볼드+▎문단+[오늘날짜]) 렌더/인쇄.

## 게이트
- §11 의료공간(진료대시보드/진료관리 의사전용 화면) 코드 무수정 — 서류 템플릿은 admin/clinic-management 관리 데이터(레지스트리 seed). 의료화면 로직 무접촉. 또한 요청자=문지은 대표원장 본인(§11 자기요청 예외).
- AC-2 충족: 전체본문 확보 후 INSERT(HOLD 해제). AC-3 무접촉: 기존 템플릿(뇌혈관약 등) 무영향(순수 ADDITIVE). AC-4 db_change:false 유지(무DDL).
