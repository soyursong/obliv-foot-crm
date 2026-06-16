---
id: T-20260616-foot-CHART2-HEX-BLUE-PURGE
title: "[2번차트] 하드코딩 파란 hex 28건 → 무채색 전수 교체 (헤더·배경·탭·텍스트)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: N/A (FE 색상 only, DB 무변경)
commit_sha: 224094ad
created: 2026-06-16
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260616-122612-2zew
---

# T-20260616-foot-CHART2-HEX-BLUE-PURGE

## 배경
70ba418 이 Tailwind `blue/indigo/sky` 유틸 클래스를 `slate` 로 변환했으나,
2번차트(`src/pages/CustomerChartPage.tsx`)의 헤더·배경·탭바·서브탭·텍스트에
하드코딩된 파란 hex 가 누락되어 화면이 여전히 푸른 계열로 남음.
현장(김주연 총괄): "2번차트 반영 안 됨, 레이아웃 컬러 그대로 푸른계열".

## 변경 (파란 6 hex 전수 교체, 총 28건)
| old (blue) | new (neutral) | 건수 | 영역 |
|---|---|---|---|
| #1e4e6e | #2d2d2d | 16 | 헤더 배경/텍스트 |
| #c8d5de | #e8e8e8 | 1 | min-h-screen 전체 배경 |
| #d8e8f0 | #e2e8f0 | 4 | 탭바 |
| #e4eef4 | #f1f5f9 | 1 | 서브탭 |
| #eef3f7 | #f8fafc | 2 | 아주 연한 파랑 |
| #334e65 | #475569 | 4 | 텍스트 |

## AC
- **AC1**: 위 파란 6 hex 잔존 0 (대소문자 무관).
- **AC2 (가드)**: green/red/amber 의미색(#dcfce7·#15803d·#bbf7d0·#fee2e2·#b91c1c·#fecaca·#facc15)
  + 브랜드 teal 절대 불변. 파일 전체 hex 전수 감사로 비대상 17 hex 전부 의미색/무채색 확인.
- **완료 조건**: 빌드 통과 + 실 브라우저 2번차트 진입해 파란 잔존 0 확인(스크린샷). 빌드/lint만 종료 금지.

## 검증
- build OK (4.35s).
- E2E `tests/e2e/T-20260616-foot-CHART2-HEX-BLUE-PURGE.spec.ts` **5 PASS**:
  (A) 소스 정적 가드 — 파란6 잔존0 / 의미색 보존 / 교체 무채색 도입 건수.
  (B) 실 브라우저 렌더 — 고객관리 행 [2번차트 열기] → 차트 진입 → DOM 전체
      computed-style 옛 파란 rgb 6종 잔존 0 단언 + 스크린샷.
- 기존 CHART2 회귀 10 PASS.
- evidence: `evidence/T-20260616-foot-CHART2-HEX-BLUE-PURGE_S1_chart.png`
  (헤더 차콜 #2d2d2d, 탭/배경 무채색, 의미색·brand teal 보존 육안 확인).
- DB 변경 없음.

## 잔여 게이트
supervisor 갤탭 실기기 현장 confirm.
