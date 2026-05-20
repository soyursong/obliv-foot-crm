---
id: T-20260520-foot-PENCHART-VIEW-SPLIT
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: 79a8118
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260520-foot-PENCHART-VIEW-SPLIT.spec.ts
risk: GO
created_at: 2026-05-20
completed_at: 2026-05-20
---

# T-20260520-foot-PENCHART-VIEW-SPLIT

상담내역 ↔ 펜차트 연동 재정비 — 읽기 전용 뷰어 분리

## 배경

PENCHART-FORM-ADD(6f1f129) 이후 regression:
- 상담내역 탭 [내용보기] 비활성 — 펜차트 저장 파일 연결 안 됨
- [작성] 클릭 시 PDF 뷰어가 아닌 자체 양식(편집 모드) 열림

## 스펙

- 상담내역 탭 = **읽기 전용 뷰어만** (form_submissions → file URL → 뷰어)
- [작성] 제거(A안) — 펜차트 탭에서 작성
- [내용보기] = 저장된 PNG/이미지 뷰어 (편집 UI 없음)
- 기존 저장 데이터(consent_forms/checklists) 보존 필수

## 수용기준

- [x] AC-1: 그룹1 [내용보기] — form_submissions personal_checklist_* 항목 있으면 활성화
- [x] AC-2: 그룹1 [작성] 버튼 제거 (A안)
- [x] AC-3: [내용보기] 클릭 시 저장된 PNG 이미지 뷰어 표시 (편집 UI 없음)
- [x] AC-4: 기존 consent_forms/checklists 데이터 보존 및 계속 표시
- [x] AC-5: 그룹2 [작성] → 펜차트 탭 이동 (B안 — REFUND-FORM 연동 전 브릿지)
- [x] AC-6: 빌드 성공 + PENCHART-FORM-ADD 회귀 없음

## 현장 클릭 시나리오

1. **펜차트 작성 → 상담내역 연동**: 펜차트 탭 → 개인정보+체크리스트 작성·저장 → 상담내역 탭 이동 → [내용보기] 활성화 → 클릭 시 저장된 PNG 표시
2. **[작성] 없음**: 상담내역 탭 그룹1 → [작성] 버튼 없음 → 사용자가 펜차트 탭으로 이동해 작성
3. **이전 데이터 호환**: 구 방식(checklists/consent_forms) 저장 데이터 → [내용보기] 기존 메타데이터 표시 유지

## 변경 파일

- `src/pages/CustomerChartPage.tsx`
  - submissionEntries 타입에 field_data 추가
  - form_submissions 쿼리에 field_data 선택
  - 그룹1 [내용보기] enabled 조건 업데이트
  - 그룹1 [작성] 버튼 제거
  - 그룹2 [작성] → 펜차트 탭 이동
  - viewDocGroup 다이얼로그: PNG 이미지 뷰어 추가
- `tests/e2e/T-20260520-foot-PENCHART-VIEW-SPLIT.spec.ts`

## DB 변경

없음 (FE 전용)
