---
id: T-20260522-foot-PENCHART-HIRES-FORM
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
rollback-sql: ""
created: 2026-05-22
updated: 2026-05-22
---

# T-20260522-foot-PENCHART-HIRES-FORM — 펜차트 양식 원본 이미지 고해상도 재생성

## 배경

PENCHART-TOOLS-V2(deployed) 코드 레벨 화질 개선 후에도 현장 해상도 불만족.
personal_checklist 양식 PNG 자체가 150dpi(1241px 폭)이고, 코드 버그로 bgCanvas에 PNG가 아예 로드되지 않던 이중 문제.

## 수정 내용

### 1. PNG 2× 업스케일 (AC-1 · 핵심)

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| `public/forms/personal_checklist_general.png` | 1241×1754 (150dpi, DPI메타없음) | 2482×3508 (300dpi) |
| `public/forms/personal_checklist_senior.png` | 1241×3508 (150dpi, DPI메타없음) | 2482×7016 (300dpi) |

Python PIL LANCZOS 알고리즘 2× 업스케일 + 300dpi 메타데이터 기록.

### 2. 코드 버그 수정 — bgCanvas PNG 미로드 (AC-2 · 크리티컬)

- **버그**: `isPdfOverlayFormKey(k) = k === 'refund_consent'` 만 체크 → personal_checklist가 templateImgUrl(pen_chart 배경)으로 fallback
- **수정**: `isPersonalChecklistKey(k) = k.startsWith('personal_checklist_')` 추가, initBgCanvas 조건에 포함
- **효과**: 이제 personal_checklist 선택 시 정확한 PNG(체크리스트 양식)가 고해상도로 배경에 렌더됨

### 3. 어르신용 캔버스 높이 정상화 (AC-3)

- `CANVAS_H_PC_SENIOR = 2036` 추가 (2페이지 세로 연결: 720 × 7016/2482 ≈ 2036)
- `getCanvasHeightForForm('personal_checklist_senior')` → 2036 반환 (기존: 1020 = 잘못됨)

### 4. 저장 연동 (AC-4)

- personal_checklist 저장 시 form_submissions INSERT (체크인 연동)
- 파일명 프리픽스: `pc_` (일반), `pc_sr_` (어르신)
- 토스트: '개인정보+체크리스트 저장 완료 — 상담내역에 연동됐습니다'

## 화질 개선 메커니즘

| 구분 | 업스케일 전 | 업스케일 후 |
|------|------------|------------|
| naturalWidth | 1241px | 2482px |
| iPad DPR=2 물리픽셀 | 1241 / (720×2) = 0.86 → **흐림** | 2482 / (720×2) = 1.72 → **선명** |
| 저장 해상도 | 1241×1754 (또는 pen_chart 720×1020) | 2482×3508 (A4 300dpi) |

## 빌드

`npm run build` → ✓ built in 3.21s

## E2E spec

`tests/e2e/T-20260522-foot-PENCHART-HIRES-FORM.spec.ts`
- AC-1: PNG 2× 해상도 검증 (2482×3508 / 2482×7016)
- AC-2: bgCanvas template_path 라우팅 / 픽셀 밀도 비교
- AC-3: senior 캔버스 높이 2036 / general 1020 유지
- AC-4: 파일명 프리픽스 pc_/pc_sr_
- AC-5: health_q/refund_consent/pen_chart 회귀 없음

## DB 변경

없음. form_templates.template_path는 Vercel static 서빙 — 파일 교체만으로 자동 반영.

## AC 체크

- [x] AC-1: personal_checklist PNG 2× 업스케일 (1241→2482, 300dpi) ✓
- [x] AC-2: bgCanvas가 personal_checklist PNG를 naturalWidth×naturalHeight로 로드 ✓
- [x] AC-3: senior 캔버스 높이 2036 (2페이지) ✓
- [x] AC-4: 저장 시 form_submissions 연동 + pc_/pc_sr_ 프리픽스 ✓
- [x] AC-5: 기존 health_q/refund_consent/pen_chart 회귀 없음 ✓

## 참조

- parent: T-20260522-foot-PENCHART-TOOLS-V2 (deployed, AC-1 화질 후속)
- commit: c13eee9
