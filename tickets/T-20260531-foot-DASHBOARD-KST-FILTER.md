---
ticket_id: T-20260531-foot-DASHBOARD-KST-FILTER
title: "오늘 접수" 명단 날짜 필터 UTC→KST 교정 (빨강 체크인 대시보드 미표시)
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
build_passed: true
e2e_spec: tests/e2e/T-20260531-foot-DASHBOARD-KST-FILTER.spec.ts
db_migration: null
regression_risk: low
reporter: 김주연 총괄 (U0ATDB587PV)
created_at: 2026-05-31
fix_applied_at: 2026-05-31
deployed_at: null
---

# T-20260531-foot-DASHBOARD-KST-FILTER

## 현장 증상 (김주연 총괄, 5/31 10:13 KST)
- 고객관리 명단에는 빨강(체크인 완료)으로 표시됨 → 풋 DB(obliv-foot-crm)에 데이터 존재 확인.
- 대시보드 "접수 현황"에는 안 보임 → 대시보드 쿼리 날짜 필터가 진짜 원인.
- slack: C0ATE5P6JTH / thread 1780183738.473379

## 근본 원인
`check_ins.checked_in_at` 은 UTC(timestamptz)로 저장. 아래 두 쿼리가 타임존 suffix 없는
naive bound(`${today}T00:00:00`)로 비교 → Postgres가 naive 문자열을 세션 tz(UTC)로 해석 →
KST 오전(00:00~09:00) 체크인(예: 07:41 KST = 전날 22:41Z)이 당일 UTC 범위 밖으로 제외됨.
- `src/components/doctor/DoctorPatientList.tsx` — "오늘 접수된 환자 목록" (today=브라우저 로컬 + naive bound)
- `src/components/PaymentMiniWindow.tsx` — "금일 시술내역" (동일 클래스)

> 선행 04930a0(CHECKIN-DASHBOARD-SYNC)은 Dashboard realtime 가드를 KST 환산으로 교정.
> 본 티켓은 같은 UTC/KST 클래스의 **명단 쿼리 bound** 잔존분 교정.

## 수정
- `today` 를 `todaySeoulISODate()`(KST) 로 산출
- bound 에 `+09:00` 부여 → `.gte('checked_in_at', \`${today}T00:00:00+09:00\`)` / `.lte(... T23:59:59+09:00)`
- Dashboard.tsx fetchCheckIns(3322)는 이미 +09:00 정상 — 변경 없음.

## AC
- AC-1: KST 오전 체크인이 +09:00 bound 범위에 포함된다 (naive bound는 제외 — 회귀 회로 AC-2).
- AC-1b: KST 오후 체크인 정상 케이스 회귀 없음.
- AC-3: 대시보드 렌더 회귀 없음.

## 검증
- npm run build ✓ (3.35s)
- E2E tests/e2e/T-20260531-foot-DASHBOARD-KST-FILTER.spec.ts AC-1/AC-1b PASS
- DB 변경: 없음
