---
id: T-20260520-foot-PENCHART-VIEW-SPLIT
domain: foot
priority: P0
status: deploy-ready
deploy-ready: true
commit_sha: 61a2b52
build_ok: true
db_changed: true
spec_file: tests/e2e/T-20260520-foot-PENCHART-VIEW-SPLIT.spec.ts
risk: GO
created_at: 2026-05-20
completed_at: 2026-05-21
reopen_reason: "배포 후 현장 미동작 — status='completed' CHECK constraint 위반 + AC-7 그룹1 미제거"
reopen_fixed_at: 2026-05-21
hotfix2_commit: 61a2b52
hotfix2_reason: "onFormSubmissionSaved callback — 펜차트 저장 후 상담내역 [내용보기] 즉시 활성화 (페이지 새로고침 불필요)"
deadline: 2026-06-05
reopen_count: 4
hotfix4_commit: d5188e9
hotfix4_reason: "REOPEN4 root cause = 펜차트 [별도 창] 팝업 저장 시 penchart-update 신호를 부모가 미구독 → submissionEntries 미갱신 → [내용보기] 버튼 새로고침 전까지 비활성. 부모 CustomerChartPage에 BroadcastChannel+storage 구독 추가. 뷰어(read) 자체는 실클릭 검증 PASS(group2/group3 이미지 렌더) — signed URL 만료 후보는 클릭 시점 재발급으로 반증."
hotfix4_evidence: "evidence/REOPEN4/05_final.png (실클릭 발건강 질문지 뷰어 렌더), 02_consult_tab.png"
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
