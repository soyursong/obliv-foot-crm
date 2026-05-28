---
ticket_id: T-20260528-foot-PENCHART-LABEL-RENAME
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
e2e_spec_exempt: true
e2e_spec_exempt_reason: FE label-only text rename, no logic change
commit: 845abb7
---

# T-20260528-foot-PENCHART-LABEL-RENAME — "펜차트 양식" → "보험차트" 명칭 수정

## 요약

사용자 노출 "펜차트 양식" / "펜차트 저장 양식" 레이블을 "보험차트"로 치환 (FE label only).

## 변경 파일

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| `src/pages/CustomerChartPage.tsx:6798` | `펜차트 저장 양식` | `보험차트 저장 양식` |
| `src/pages/CustomerChartPage.tsx:4148` | `pen_chart: '펜차트'` | `pen_chart: '보험차트'` |
| `src/components/PenChartTab.tsx:2379` | `펜차트 — 양식 작성` | `보험차트 — 양식 작성` |

## AC 검증

- [x] 사용자 노출 "펜 차트 양식" / "펜차트 양식" / "펜차트 저장 양식" → "보험차트" 치환
- [x] 내부 변수명/컴포넌트명 변경 없음 (pen_chart, PenChartTab 등 유지)
- [x] 빌드 성공 (`npm run build` ✓ 3.29s)
- [x] E2E spec 면제 (텍스트 레이블 변경만, risk 0/5)

## 비고

- DB 변경 없음 (form_templates.name_ko는 이미 '[보험차트]'로 기존 마이그레이션 적용)
- BUILTIN_PEN_CHART_TEMPLATE.name_ko = '[보험차트]' 유지 (변경 범위 외)
- commit: 845abb7 → Vercel 자동 배포
