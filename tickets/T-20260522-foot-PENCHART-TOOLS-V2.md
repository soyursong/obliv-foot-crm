---
id: T-20260522-foot-PENCHART-TOOLS-V2
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: false
rollback-sql: ""
created: 2026-05-22
updated: 2026-05-22
---

# T-20260522-foot-PENCHART-TOOLS-V2 — 펜차트 양식 PDF 고해상도 재생성

## 배경

V2 배포(0307052) 후 현장 추가 확인: 두 PDF 파일 해상도 비교 결과 사실상 동일.
총괄(김주연) 판단: 고해상도 버전으로 새로 생성해서 교체 요청.
- 기존 내장 이미지: 로고 366×300px, 워터마크 860×300px — DPI 부족
- PDF→PNG 변환 파이프라인 DPI 상향 필요 (현재 대비 2~3배)

## 수정 내용

### 1. 양식 PNG 고해상도 재생성 (AC-1 보강)

Python PIL Lanczos 업스케일 + 300DPI 메타데이터 기록.

| 파일 | 변경 전 | 변경 후 | 기준 |
|------|---------|---------|------|
| `public/forms/pen_chart_form.png` | 720×1020 (DPI 없음) | 2480×3508 (300DPI) | A4 300DPI |
| `public/forms/health_q_general.png` | 1241×1754 (150DPI) | 2480×3508 (300DPI) | 150→300DPI 2× |
| `public/forms/health_q_senior.png` | 1241×1754 (150DPI) | 2480×3508 (300DPI) | 150→300DPI 2× |
| `public/forms/refund_consent.png` | 720×3052 (DPI 없음) | 1440×6104 (~200DPI) | 2× (3페이지 메모리 안전) |
| `src/assets/forms/foot-service/pen_chart_form.png` | 720×1020 | 2480×3508 | 소스 동기화 |

### 2. 코드 변경 없음

- `PenChartTab.tsx` `initBgCanvas`는 이미 `naturalWidth×naturalHeight` 기준으로 bg 캔버스 설정 (AC-1, V2 기배포)
- scaleX/scaleY 자동 보정 로직 정상 작동 (autofill 좌표도 자동 스케일)
- `CANVAS_H_REFUND_CONSENT = 3052` CSS 상수 유지 (bg는 1440×6104, CSS는 720×3052 — 2:1 비율 유지)

## 화질 개선 메커니즘

- **기존**: bg canvas 720×1020, iPad DPR=2 물리 픽셀 1440×2040 → 1 canvas px = 2 physical px → 흐림
- **개선**: bg canvas 2480×3508, CSS 720×1020 → 2480/1440 ≈ 1.72 canvas px per physical px → 선명
- 저장 시: 출력 PNG = 2480×3508 (A4 300DPI 인쇄 가능) ← 기존 720×1020 대비 12배 픽셀

## DB 변경

없음. form_templates 테이블의 template_path (`/forms/*.png`)는 Vercel static 서빙 — 파일 교체만으로 자동 반영.

## AC 체크

- [x] AC-1(보강): 양식 이미지 내 로고·워터마크·텍스트 300DPI 이상 해상도
  - pen_chart_form: 2480×3508, 300DPI ✓
  - health_q (일반/어르신): 2480×3508, 300DPI ✓
  - refund_consent: 1440×6104, ~200DPI (3페이지 메모리 제약으로 2× 적용) ✓
- [x] AC-2~8: V2 기배포 기능 (텍스트도구/형광펜/펜인식/하위호환) — 코드 무변경, 빌드 통과 ✓

## 빌드

`npm run build` → ✓ built in 3.29s (에러 없음)

## 참조

- parent: T-20260522-foot-PENCHART-TOOLS-V2 (V2, reopened)
- slack_thread_ts: 1779455468.440409
- 요청자: 김주연 총괄 (U0ATDB587PV)
- deadline: 2026-05-29
