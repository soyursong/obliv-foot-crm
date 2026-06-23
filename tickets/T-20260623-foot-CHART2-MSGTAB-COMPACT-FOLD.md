---
ticket_id: T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD
id: T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-23
owner: agent-fdd-dev-foot
requester: 현장(C0ATE5P6JTH, 김주연 총괄 U0ATDB587PV, thread 1782181380.662399)
approved_by: planner NEW-TASK MSG-20260623-120411-88xr (risk GO, FE-only)
build_ok: true
spec_added: tests/e2e/T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD.spec.ts
db_changed: false
data_architect_consult: 면제 — 순수 FE 레이아웃/토글, 신규 컬럼·테이블·enum 없음, DB/EF/외부서비스 무관(가역)
risk_level: GO (1/5 — 메시지 탭 표시 컴팩트 + 클라이언트 UI state 접기/펼치기. 비즈로직·insert·refresh 불변)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-23
deploy_commit: 802f9803
commit_sha: 802f9803
---

# T-20260623-foot-CHART2-MSGTAB-COMPACT-FOLD

2번차트(CustomerChartPage) 메시지 탭 컴팩트화 + 발송완료 접기/펼치기.

## 구현
- ① 메시지 탭(`chartTabGroup==='history' && chartTab==='messages'`) 3블록(문자 이력 등록 / 자동 SMS 발송 이력 notification_logs / 수동 문자 기록 message_logs) 세로 밀도 추가 컴팩트 — p-2.5→p-2, mb-2→mb-1.5, 외부 컨테이너 space-y-2→space-y-1.5.
- ② "발송 완료된 내용"(자동 SMS 이력 + 수동 문자 기록) 접기/펼치기 토글 신설, 기본=접힘.
  - 토글 헤더 카운트 배지 "N건" = `notificationLogs.length + messageLogs.length`.
  - chevron 방향 분기(열림 ▼ / 닫힘 ▸), `data-testid="msg-sent-history-toggle"`.
  - `msgSentHistoryOpen` 순수 클라이언트 UI state — DB 영속화 없음.
  - 신규 입력 폼(문자 이력 등록)은 접기 대상 아님 = 토글 래퍼 밖 상시 노출.

## 보존
- insert(message_logs)·refreshNotificationLogs·refreshMessageLogs·koNotiError·statusLabel·eventLabel 전부 불변.
- MONOTONE 컬러 토큰(sage 그레이) 일관 유지.

## REDEFINITION_RISK
- 동일 파일 CHART2-VISITHIST-COMPACT-REISSUE(진료내역 탭)·CHART2-MONOTONE-3MOCKUP(컬러 토큰)과 변경 라인 비중첩 — messages 탭 한정.

## 검증
- 빌드 OK(4.95s).
- E2E spec 8 PASS (앱 로드 200 + 정적 구조 7).
- 갤탭 실기기 현장 confirm 체크리스트는 spec 하단 참조.

## 완료 알림 라우팅
- thread 1782181380.662399, <@U0ATDB587PV> 김주연 총괄, C0ATE5P6JTH.
