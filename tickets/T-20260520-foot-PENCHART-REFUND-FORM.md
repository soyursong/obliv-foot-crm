---
id: T-20260520-foot-PENCHART-REFUND-FORM
domain: foot
status: in-progress
deploy-ready: false
commit_sha: TBD
build_ok: false
db_changed: false
spec_file: tests/e2e/T-20260520-foot-PENCHART-REFUND-FORM.spec.ts
risk: GO
created_at: 2026-05-20
completed_at: TBD
---

# T-20260520-foot-PENCHART-REFUND-FORM

펜차트 양식 추가 — [환불/비급여동의서] PDF 원본 + 오버레이 입력

## 배경

- PDF 파일: `/file_inbox/20260520/183905_F0B4U7Y4GDR_비급여 및 환불 동의서(최종)_260502.pdf` (449KB)
- PENCHART-FORM-ADD 패턴 100% 재사용 (PDF 원본 배경 + 오버레이 입력 + 서명 캡처)
- PENCHART-FULLSCREEN fullscreen modal 적용 대상
- 양식 선택 패널 + list 뱃지 추가

## 스펙

- PDF → PNG 변환 후 `/public/forms/refund_consent.png` 배포
- PenChartTab select 패널에 [환불/비급여 동의서] 카드 추가
- 저장: `photos` storage `customer/{id}/pen-chart/rc_{ts}_{rand}.png` + form_submissions 저장
- form_key: `refund_consent`
- 상담내역 그룹2 [내용보기]: form_submissions refund_consent 항목 있으면 활성화 + PNG 뷰어

## 수용기준

- [x] AC-1: 양식 선택 패널에 [환불/비급여 동의서] 카드 표시 (rose/pink 계열 색상)
- [x] AC-2: 선택 시 PDF 원본 배경 + 오버레이 draw 모드 (PENCHART-FORM-ADD 패턴)
- [x] AC-3: 서명 캡처 패드 표시 (isPdfOverlayFormKey 확장)
- [x] AC-4: 저장 시 storage `rc_` prefix + form_submissions refund_consent 행 삽입
- [x] AC-5: list 뱃지 배열에 [환불/비급여 동의서] 뱃지 추가
- [x] AC-6: 상담내역 그룹2 [내용보기] — refund_consent 항목 있으면 활성화
- [x] AC-7: 빌드 성공 + 기존 양식 회귀 없음

## 현장 클릭 시나리오

1. **신규 환불동의서 작성**: 펜차트 탭 → [새 차트 작성] → [환불/비급여 동의서] 선택 → fullscreen draw 모드 → 태블릿펜 기입 → 서명 → 저장 → list 복귀
2. **상담내역 뷰어**: 상담내역 탭 → 그룹2 [내용보기] 활성화 → 클릭 시 저장된 PNG 표시
3. **기존 동의서 유지**: 구 방식 consent_forms 데이터 → 기존 메타데이터 표시 유지

## 변경 파일

- `public/forms/refund_consent.png` (PDF→PNG 변환 에셋)
- `src/components/PenChartTab.tsx`
  - BUILTIN_REFUND_CONSENT 템플릿 추가
  - isRefundConsentFormKey() 헬퍼 추가 또는 isPdfOverlayFormKey 확장
  - select 패널 카드 추가
  - draw 저장 로직 rc_ prefix
  - list 뱃지 추가
- `src/pages/CustomerChartPage.tsx`
  - 그룹2 [내용보기] enabled 조건에 refund_consent 추가
  - viewDocGroup=2 다이얼로그: PNG 이미지 뷰어 추가
  - 그룹2 [작성] 버튼 제거 (A안 최종)
- `tests/e2e/T-20260520-foot-PENCHART-REFUND-FORM.spec.ts`

## DB 변경

없음 (FE 전용, storage + form_submissions 행 추가는 런타임)
