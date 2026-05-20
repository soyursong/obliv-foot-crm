---
id: T-20260520-foot-PENCHART-FULLSCREEN
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: TBD
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260520-foot-PENCHART-FULLSCREEN.spec.ts
risk: GO
created_at: 2026-05-20
completed_at: 2026-05-20
scope_expanded_at: 2026-05-20T18:30
---

# T-20260520-foot-PENCHART-FULLSCREEN

펜차트 양식 클릭 시 별도창(fullscreen modal) + 태블릿 확대 — 고객 기입 시 차트 내용 비노출
**스코프 확장 (김주연 총괄 18:30): "펜차트 탭에 들어가는 양식들은 전부 동일하게 구현해줘! 테블릿 최적화 탭이라고 보면 됨"**

## 구현 요약

`PenChartTab` draw/fill 모드 진입 시 shadcn `Dialog size="fullscreen"` 래퍼 적용.
배경 차트 내용(CustomerChartSheet z-[70], MedicalChartPanel z-[90])을 완전 차단.

**스코프 확장 구현:**
- `FullscreenFormWrapper` 공통 래퍼 컴포넌트 추출 — `Dialog size="fullscreen" hideClose` 캡슐화
- `select` 모드 (양식 선택 패널)도 fullscreen 적용 (기존 누락)
- `draw` / `fill` 모드도 FullscreenFormWrapper로 리팩터 — 개별 Dialog 코드 제거
- 향후 신규 양식 추가 시 FullscreenFormWrapper 적용만으로 자동 fullscreen

## 변경 파일

- `src/components/PenChartTab.tsx` — FullscreenFormWrapper 컴포넌트 + select/draw/fill 모드 공통 래퍼 적용
- `tests/e2e/T-20260520-foot-PENCHART-FULLSCREEN.spec.ts` — AC-5~8 신규 스펙 추가

## 수용기준 체크

- [x] AC-1: 양식 클릭 시 fullscreen modal(Dialog size="fullscreen") 오픈
- [x] AC-2: 태블릿 전체화면 확대 레이아웃 (draw: flex-col + flex-1 scroll, fill: overflow-auto)
- [x] AC-3: 기존 펜 입력/체크박스/서명/저장 동일 동작 (내부 로직 무변경)
- [x] AC-4: 닫기 시 list 모드 복귀 + 미저장 경고 (hasDrawing confirm 유지)
- [x] AC-5: pen_chart_form.png + 상용구 8종 포함 모든 draw 진입 fullscreen modal 필수 (조건부→필수)
- [x] AC-6: 모든 양식(select/draw/fill) 동일 UX — FullscreenFormWrapper 단일 래퍼, 개별 예외 없음
- [x] AC-7: 향후 신규 양식도 FullscreenFormWrapper 적용만으로 자동 fullscreen (확장성 보장)
- [x] AC-8: 빌드 성공 + PENCHART-FORM-ADD 회귀 없음

## DB 변경

없음 (FE 레이아웃 전환만)

## 배포

Vercel main merge 자동 배포 (commit TBD — 스코프 확장 커밋)
