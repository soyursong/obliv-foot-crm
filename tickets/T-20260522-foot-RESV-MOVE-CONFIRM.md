---
id: T-20260522-foot-RESV-MOVE-CONFIRM
title: 예약 슬롯 이동 시 확인 다이얼로그 추가
domain: foot
status: cancelled
priority: P2
created: 2026-05-22
cancelled: 2026-05-22
cancelled_reason: "대표 방침 — 슬롯 이동할 때 안내창 팝업 굳이 필요없다. 착수 금지."
superseded_by: T-20260522-foot-SLOT-POPUP-REGRESS
deploy_ready: false
db_changes: false
---

## 취소 사유

MSG-20260522-113428-2ide (planner CANCELLATION):
대표 방침 — "슬롯 이동할 때 안내창 팝업 굳이 필요없다."
슬롯 이동 시 확인창 추가 불필요.

기존 NEW-TASK MQ(MSG-20260522-100524-053w) 무시. 이 티켓 착수 금지.

## 대체 티켓

T-20260522-foot-SLOT-POPUP-REGRESS — 이미 삽입된 팝업 코드 회귀 수정으로 제거.
