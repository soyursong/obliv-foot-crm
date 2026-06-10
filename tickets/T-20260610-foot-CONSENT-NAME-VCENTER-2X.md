---
id: T-20260610-foot-CONSENT-NAME-VCENTER-2X
title: "[동의서] 자동삽입 성명 세로중앙 + 글자 2배 (환불동의서 P3 성명란)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 9b5d7c4
created: 2026-06-10
assignee: dev-foot
reporter: 김주연(현장 총괄)
source_msg: MSG-20260610-084913-h9fm
needs_field_confirm: true
related_tickets:
  - T-20260609-foot-CONSENT-NAME-CENTER-FONT
  - T-20260523-foot-PENCHART-FORM-AUTOFILL
  - T-20260609-foot-RESV-CONSENT-SPEC-DRIFT
---

# T-20260610-foot-CONSENT-NAME-VCENTER-2X

## 요청 (김주연 총괄)
"하단으로 너무 쏠려있음 — 성명칸 중앙 배치 + 사이즈 2배"
= 직전 CONSENT-NAME-CENTER-FONT(deployed 3e0216b, 가로중앙+bold 28px) 위 증분.

## 대상
`src/components/PenChartTab.tsx` · `drawRefundP3NameAutofill` (단일 슬롯) + 상수 `REFUND_P3_NAME`.

## 변경
- **세로중앙**: textBaseline='top' + topY 동적 계산 = `cellTop + (cellHeight - fontSize)/2`
  → base 56px 기준 topY=3154 (셀 상단 3123 / 밑줄 3241, 높이 118 → 상/하 여백 각 31px).
  직전 topY=3214(밑줄 하단 안착)의 "아래쏠림" 해소 (위로 60px).
- **폰트 2배**: baseFontSize 28→56, minFontSize 14→28 (bold, italic 제거).
- **AC-3 클램프 2x 재산정**: measureText 폭 > maxWidth(226) 시 비례축소, 하한 28px.
  클램프 시 topY 동적 재계산으로 세로중앙 유지.
- **불변(회귀금지)**: 가로중심 centerX=247 + textAlign='center' (3e0216b 좌표 되돌림 금지).

## AC 검증
- AC-1 세로중앙(칸 상단 침범 금지) — topY=3154, 상/하 여백 31px 균등 ✓
- AC-2 ~2x — baseFontSize 56 ✓
- AC-3 긴이름 클램프 2x 재산정 — maxWidth 226 / minFontSize 28, topY 동적 ✓
- AC-4 가로중앙 회귀X — centerX=247, textAlign='center' 불변 ✓
- AC-5 iPad+GalaxyTab 동일렌더 — 논리좌표 합성 + DRAW_DPR=2 강제 ✓

## 측정 근거 (PIL refund_consent.png 1588×6736, scale=2.0)
- canvas y=3123 = 라벨/입력 구분선(cellTop), y=3241 = 밑줄(cellBottom), 칸 높이 118.
- 세로 칸막이 x=96 / 396.5 / 697.5 → 성명칸 중심 246.25 ≈ 247.

## REDEFINITION 수렴
동일 슬롯 4번째 터치(좌표→자동삽입→가로중앙/폰트→세로/2x). ping-pong 아님(육안 시각지시 증분).
현재 상수값(centerX=247/topY=3154/cellTop=3123/cellBottom=3241/baseFontSize=56/minFontSize=28/maxWidth=226)을
코드 코멘트로 노출 → 5번째 미세조정 1회 수렴 유도.

## RESV-CONSENT-SPEC-DRIFT 대응
E2E spec(T-20260610-foot-CONSENT-NAME-VCENTER-2X.spec.ts)의 폰트/위치 어서션을 56/3154/3123/3241/247로 동기화.
직전 CONSENT-NAME-CENTER-FONT.spec.ts 어서션도 갱신(같은 커밋).

## DB / 배포
- DB변경 없음 (FE Canvas 렌더) → 마이그레이션·data-architect CONSULT·DB게이트 불요(§S2.4 신규 컬럼/테이블/enum 0).
- 신규 npm 0.
- build OK (vite ✓ built 3.69s, tsc 에러 0).
- commit 9b5d7c4 (main → Vercel 자동), push 완료.
