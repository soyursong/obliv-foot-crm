---
id: T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST
title: "치료테이블 [균검사&피검사 대상자] 탭 분리 + 피검사 일일 진행 리스트 신규"
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-07-25T01:20:00+09:00"
commit: 0293d932
db_change: false
build_pass: true
spec_added: true
spec_file: tests/e2e/T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST.spec.ts
da_consult: 면제 (신규 영속 필드 0 — form_submissions.field_data JSONB 재사용, builtin template_id NULL 패턴. LABTEST T-20260723 선례 봉투)
risk: 1/5
reporter: planner (MSG-20260724-112349-cj81)
assignee: dev-foot
created_at: 2026-07-24
completed_at: 2026-07-25
---

# T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST

치료테이블 [균검사&피검사 대상자] 단일 탭을 [균검사]/[피검사] 2탭으로 분리 + 피검사 일일 진행 리스트 8컬럼 양식 신규 구현.

## 핵심 3건

1. **탭 분리** — 치료테이블 [균검사&피검사 대상자] 단일 탭 → [균검사]/[피검사] 2탭.
   - 균검사 = 기존 `ExamTargetsSection` 그대로 이관(코드 무변경, 회귀0). testid `tab-exam-targets` 유지.
   - 피검사 = `BloodDailyListSection` 신규 (testid `tab-blood-daily`).
2. **피검사 일일 진행 리스트** — 8컬럼(순서·검사일자·환자명·차트번호·생년월일·접수여부[체크박스]·접수자명·서류수령여부[체크박스]).
   - 레이아웃 정본 = mockup `F0BLB4L8MBJ_blood_test_form.jpg` (컬럼순서·색상 그대로).
   - 색상: 접수여부/접수자명=핑크(bg-pink-50), 서류수령여부=노랑(bg-yellow-50).
   - 체크박스: 미완료=빨간테두리 / 접수 완료=빨간체크 / 서류수령 완료=녹색체크.
3. **체크박스 상태 DB 저장/불러오기** — 재진입 시 유지.

## 데이터 결정 (db_change → false, 재사용 우선)

LABTEST(T-20260723) 선례대로 **기존 영속구조 재사용**으로 신규 스키마 0 달성:
- `form_submissions` 재사용 — `template_id=NULL` + `field_data.form_key='blood_reception_daily'`
  (PenChart builtin 양식과 동일 확립 패턴, no-DDL).
- `field_data = { form_key, request_date, received, receiver_name, docs_received }`.
- 키 = customer_id × 검사신청일(request_date). 없으면 INSERT / 있으면 UPDATE(field_data 병합).
- **신규 영속 필드 0 → data-architect CONSULT 게이트 면제** (ADDITIVE도 아님, JSONB 소비).

리스트업 = `check_in_services.blood_test_requested=true` 환자 × 검사신청일(`check_ins.checked_in_at` KST).
ExamTargetsSection 데이터 계약 read-only 재사용. ADDITIVE 미적용 prod(42703) → 빈 목록 폴백.

## 검증

- build OK (`npm run build`)
- E2E: `tests/e2e/T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST.spec.ts` 8/8 PASS
- 회귀: 치료테이블/exam 관련 spec 39/39 PASS (ExamTargetsSection 무변경)

## 배포

- CF Pages (main push 자동). DB 변경 없음(no-DDL) → 마이그레이션·DDL-diff 불요.

## 잔여 노트 (follow-up 후보, 이번 범위 밖)

- 균검사 탭(ExamTargetsSection)은 회귀0 원칙으로 무변경 이관 — 내부적으로 피검사 badge/결과지 행이 여전히 표기됨.
  현장이 균검사 탭에서 피검사 요소 제거를 원하면 별도 티켓으로 처리(이번 티켓은 탭 분리 + 피검사 신규 양식만).
