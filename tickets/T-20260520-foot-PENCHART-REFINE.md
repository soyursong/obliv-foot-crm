---
id: T-20260520-foot-PENCHART-REFINE
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: e0e3f55
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260520-foot-PENCHART-REFINE.spec.ts
risk: GO
created_at: 2026-05-20
completed_at: 2026-05-20
---

# T-20260520-foot-PENCHART-REFINE

펜차트↔상담내역 연동 재정비 + 환불/비급여동의서 [내용보기] 활성화

## 배경

현장 2건 요청:
1. 상담내역↔펜차트 연동 깨짐: 체크리스트 작성·저장 후 상담내역 [내용보기] 미활성 + [작성] 시 자체양식 열림
2. 환불/비급여동의서 양식 등록 + 태블릿 캔버스 기입

## 근본 원인

- PenChartTab builtin 템플릿(`id: 'builtin-refund-consent'`)으로 저장 시 `template_id` FK 생략
- `form_submissions` JOIN `form_templates!template_id(form_key)` → null
- `template_key = null` → `submissionEntries.some((s) => s.template_key === 'refund_consent')` false
- Group 2 [내용보기] disabled 유지

## 수용기준

- [ ] AC-1: 펜차트 저장 후 상담내역 [내용보기] 활성화
- [ ] AC-2: [내용보기] → 읽기전용 뷰어 (PNG 이미지 표시)
- [ ] AC-3: 상담내역 [작성] → 자체양식 안 열림 (펜차트 라우팅 or 비활성)
- [ ] AC-5: 환불/비급여동의서 PDF 배경 로드 정상
- [ ] AC-6: 펜 기입 가능
- [ ] AC-7: 저장 후 storage rc_ prefix + form_submissions 행 삽입
- [ ] AC-9: 기존 양식(pen_chart, health_questionnaire_*) 무영향

## 변경 내용

### 1. CustomerChartPage.tsx (AC-1 핵심 fix)

`setSubmissionEntries` 매핑에서 `field_data.form_key` fallback 추가:
```ts
// Before
template_key: (s.form_templates as { form_key: string } | null)?.form_key,

// After (T-20260520-foot-PENCHART-REFINE AC-1)
template_key: (s.form_templates as { form_key: string } | null)?.form_key
  ?? ((s.field_data as Record<string, unknown> | null)?.form_key as string | undefined),
```

builtin 템플릿 저장 시 `template_id` FK 없어도 `field_data.form_key`로 fallback → [내용보기] 활성화.

### 2. AC-3 상태 확인 (코드 변경 없음)

- Group 1: [작성] 버튼 없음 (PENCHART-VIEW-SPLIT AC-2) ✓
- Group 2: [펜차트에서 작성] → `handleClinicalTab('pen_chart')` ✓

### 3. AC-5~7 상태 확인 (코드 변경 없음)

- `public/forms/refund_consent.png` (720×3052, 395K) 존재 ✓
- PenChartTab `BUILTIN_REFUND_CONSENT` + `isPdfOverlayFormKey` + 서명 패드 ✓
- 저장: `rc_` prefix + `form_submissions` insert ✓

## DB 변경

없음 (FE 전용)
