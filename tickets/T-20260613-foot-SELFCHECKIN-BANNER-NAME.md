---
id: T-20260613-foot-SELFCHECKIN-BANNER-NAME
domain: foot
priority: P2
status: deploy-ready
deploy_ready_at: 2026-06-13 08:20
commit_sha: e4e53dd
db_changed: false
db_migration: null
db_migration_note: null
e2e_spec: tests/e2e/T-20260613-foot-SELFCHECKIN-BANNER-NAME.spec.ts
e2e_spec_exempt_reason: null
e2e_result: "신규 spec 3TC(AC-1 재진/AC-2 초진/AC-3 성함결손) 전건 PASS + SELFLOGIN 4TC 회귀 PASS (8 passed, route-mock 결정론). VISITPATH 6건 실패는 사전(deprecated jongno-foot slug + walk-in 모달 텍스트 노후) 본 티켓 무관."
hotfix: false
created: 2026-06-13
deadline: null
slack_channel: C0ATE5P6JTH
reporter: ops-planner
risk_verdict: GO
deploy_dependency: "foot-checkin.pages.dev 자동배포 차단(T-20260610-foot-SELFCHECKIN-LEADSRC-UI-REFIX P0/blocked, GitHub Actions billing/CF token, 형 조치대기)과 동일 묶음. 코드는 deploy-ready, 배포는 파이프라인 복구 후."
---

# T-20260613-foot-SELFCHECKIN-BANNER-NAME — 셀프접수 예약 배너 성함 표기

## 구현 요약
- `reservationBanner` state: `{time,visitType}` → `+name`(ref 원본 `rawReservationsRef`, DB 추가조회 없음)
- `handleSelectReservation`: `setReservationBanner` 에 `name: rawName` 주입
- 배너 렌더 성함 접두 `"{name}님, "` + 빈값 가드(`name` 없으면 접두 생략), i18n 키 `reservationBanner` 본문 유지
- **confirm 화면 배너 신설**: 티켓 [3]의 "L2454=재진/confirm" 은 실제로는 입력화면 배너였고 confirm 엔 배너가 없었음.
  재진 select 경로는 input→confirm 직행이라 기존 2배너(personal_info/input)를 못 봄 →
  AC-1(재진 성함) 충족 위해 confirm 헤딩 하단에 동일 배너 추가
- 전화-직접조회 경로 배너는 name select 미수집(DB 조회 추가 없음) → `name:''` → 접두 생략(빈값 가드)

## AC 충족
- AC-1 재진: confirm 배너 "{name}님, 오늘 예약이 있습니다: {time} 재진" — PASS
- AC-2 초진: personal_info 배너 성함 — PASS
- AC-3 비마스킹+빈값가드: name 빈값 시 "님," 접두 생략 — PASS
- AC-4 i18n 키 유지: reservationBanner 본문 동일 — PASS

## DB 변경
없음.
