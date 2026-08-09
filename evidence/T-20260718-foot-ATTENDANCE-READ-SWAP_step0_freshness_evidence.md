# T-20260718-foot-ATTENDANCE-READ-SWAP — step0 배포前 freshness 재검증 evidence

- 티켓: T-20260718-foot-ATTENDANCE-READ-SWAP (GATE-RELEASE MSG-20260810-075119-cdtt)
- 집행: dev-foot / 2026-08-10 07:53~07:55 KST
- proj: rxlomoozakkjesdqjtvd (obliv-foot-crm prod)
- 목적: 모기 티켓 soak 48h 연속-틱 로깅 evidence 공백 봉합 — 배포前 staff_attendance freshness 실측.
- 판정: **CLEAN ✅ → step1 진행 허용** (stale/broken 아님 → main merge STOP 불발동)

## 판정 기준 (planner step0)
1. last_sync age < 15min
2. unmatched=0 / errors=0
3. 시트 '오늘 출근자'수 == staff_attendance present 카운트 정합

## A. READ-ONLY probe (scripts/..._step0_freshness.mjs)
- **freshness**: `max(synced_at)` = 2026-08-09 22:45:01 UTC (= 07:45:01 KST), age **8.77min < 15min** ✅
  - cron `foot-attendance-sync` `*/15 * * * *` active=true ✅ (자율 무인 틱 정상)
- **today present** (2026-08-10 KST, clinic 오리진 74967aea): **14명**
  (강경민·김규리·김주연·박민석·서은정·송지현·이정인·장예지·정연주·진이서·최민지·최현희·한예슬 + 1)
- **최근 5 cron 틱**(net._http_response, 07:00~07:45 KST): 전부 status_code=200 · ok=true · **unmatched=[] · errors=[]** ✅
  (ids 207066/207119/207175/207234/207287, updated=183 window reconcile)

## B. LIVE-TICK same-instant 3자 정합 (scripts/..._step0_livetick.mjs, evidence#1 방법론 재현)
- pg-worker 경로 `SELECT public.trigger_attendance_sync()` (cron 동일 경로, idempotent) 발화 07:54:44 KST
- EF 응답(net._http_response id 207319): status_code=200 · ok=true · **unmatched=[] · errors=[]** · staff_active=41 · updated=183 · inserted=0 · deleted=0
- present(today) **pre==post = 14 == 14** (멱등·안정) ✅
- 3자 정합: 라이브 시트 reconcile unmatched=0/errors=0 → 시트 매칭 출근자 == DB present = **14** ✅

## VERDICT
- age<15min ✅ · unmatched=0/errors=0 ✅ · 시트present==DB present(14) ✅ → **CLEAN**
- ⇒ READ-SWAP step1(main merge) 진행. sync 회귀 없음 → 모기 reopen/신규 sync-fix 티켓 불요.
- ⇒ 배포 자체는 step2 supervisor full QA GO 후 (본 evidence 는 배포前 게이트 봉합만).
