---
id: T-20260726-foot-RECEIVER-COORD-ACCT-DROPDOWN-WIDTH
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260726-foot-RECEIVER-COORD-ACCT-DROPDOWN-WIDTH.spec.ts
summary: "치료테이블 > 피검사 탭('피검사 일일 진행 리스트', BloodDailyListSection) 접수자명 개선 + 4컬럼 폭 균일. ①접수자명 자유입력(input) → 코디네이터 계정 드롭다운(select). 목록 = staff(role='coordinator', active=true) × 현재 클리닉(=종로풋센터), 이름 오름차순. derm ASSIGNEE-DROPDOWN 계열(role 필터+name 정렬) 하드포크 이식. 저장값 = 現 field_data.receiver_name(이름 문자열) 그대로 재사용 → 선택값 저장·재조회 정상. 신규 스키마 0(no-DDL), staff read-only. ②접수여부/접수자명/서류수령여부/업로드 4컬럼 폭 균일(w-32). BLOODLIST-4FIX 동일 화면 위 증분."
created: 2026-07-26
risk_verdict: GO
risk_reason: "변경 격리 = BloodDailyListSection.tsx 1파일 + 신규 spec 1. useCoordinators 훅(staff role='coordinator'/active=true/clinic_id 스코프, 이름 정렬) = read-only, DDL/스키마 무접촉(db-change=false). 저장 경로는 현행 usePersistReception → field_data.receiver_name 문자열 그대로(신규 컬럼 0) → 선택값 저장·재조회 정상. 목록 밖 저장값(레거시 자유입력/퇴사 코디)은 '(목록 외)' 임시 옵션으로 보존 → 미선택 덮임 방지. staff 미적용/스키마 불일치 prod 는 빈 목록 폴백(섹션 무파손). 4컬럼 폭 = w-32 균일(정확히 4개 th). 신규 spec 10 AC 10/10 PASS + BLOODLIST-4FIX·EXAM-MANUAL·TESTITEM-ACTIONS 회귀 34/34 PASS + npm run build PASS. 의료게이트 §11.1: 치료테이블(치료사 surface) = gate-exempt(비의료직군 화면). da_consult: 불요(신규 컬럼·테이블·enum 0, read-only + 기존 필드 재사용)."
reporter: planner
bundled_with: T-20260726-foot-TREATTABLE-LABTAB-BLOODLIST-4FIX
commit: 7c38d4ad
---

# T-20260726-foot-RECEIVER-COORD-ACCT-DROPDOWN-WIDTH

## 확정 스펙 (planner MSG-20260726-165207-7jck)
1. 접수자명 필드 → 드롭다운(계정 선택). 목록 = staff role='코디네이터'(coordinator) AND branch=종로풋센터(현재 클리닉) AND 재직중(active). read-only, 스키마 무변경. 선택값 저장·재조회 정상.
2. 4컬럼(접수여부/접수자명/서류수령여부/업로드) 폭 균일(w-32).
3. derm ASSIGNEE-DROPDOWN 계열(role 필터+정렬 선례) 풋 하드포크 이식.

## 구현
- `src/components/treatment/BloodDailyListSection.tsx`
  - `useCoordinators(clinicId)` 신규 훅 — staff(role='coordinator', active=true, clinic_id=현재 클리닉), 이름 오름차순. 폴백/필터 방어.
  - `ReceiverNameCell` = `<input>` → `<select data-testid="blood-receiver-select">`. value=저장된 receiver_name, onChange 즉시 저장. 목록 외 값 보존 옵션.
  - 4컬럼 th 에 `w-32` 균일 적용.

## AC
- [x] 접수자명이 드롭다운(계정 선택)으로 렌더
- [x] 드롭다운 목록 = 종로풋센터 코디네이터(role='coordinator', clinic 스코프, active)
- [x] 선택값 저장·재조회 정상 (field_data.receiver_name 재사용)
- [x] 4컬럼 너비 균일 (w-32)
- [x] 4FIX 동일 화면 회귀 없음 (BLOODLIST-4FIX 34건 회귀 PASS)
