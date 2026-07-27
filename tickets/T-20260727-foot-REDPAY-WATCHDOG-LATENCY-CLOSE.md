---
id: T-20260727-foot-REDPAY-WATCHDOG-LATENCY-CLOSE
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: "ef_only — scripts/redpay_macstudio_poller.mjs --self-test (10/10 PASS, AC-4 재현 테스트로 대체)"
summary: "레드페이 폴러(redpay_macstudio_poller.mjs)에 '미등록 TID 즉시 알람' 훅 추가(Option b). 폴러가 매 사이클 이미 계산하는 drift(=merchant 인정 + 미등록 TID)를 즉시 슬랙 알람으로 재사용 → 신 TID 인지창을 워치독 일배치 24h → 폴러주기(launchd 300s, ≤1h) 로 단축(AC-1). dedup(AC-2)=워치독과 동일 상태파일(~/.redpay-watchdog-<domain>-state.json)의 alerted_tids 공유 → first_alerted 기준 슬랙 폭격 방지 + 폴러/워치독 상호 이중알람 방지. 원자적 write(temp+rename)로 워치독 partial-read 차단. 워치독 일배치=백스톱 유지, biznos 태그[457-23-00938] 무변경(AC-3). TID=COALESCE(col_tid,data.tid)로 워치독과 정합(admit=merchant_id 권위 무접촉, 알람 payload 전용). fail-safe: 슬랙/상태 오류 전부 비치명(적재 본업 무영향) + 킬스위치 REDPAY_POLLER_TID_ALARM_ENABLED."
created: 2026-07-27
risk_verdict: GO
risk_reason: "변경 격리 = scripts/redpay_macstudio_poller.mjs 1파일(FE·DB·EF 무접촉). additive 훅 — 기존 fetch/필터/upsert/heartbeat 경로 전부 무변경, drift 누적본 위에 알람만 얹음. admit 판정(filterToFootScope, merchant_id 권위)은 미변경 → 적재 정확도 회귀 0. 신규 launchd/중복 폴링 0(기존 300s 사이클 재사용). db-change=false(신규 컬럼·테이블·enum 0, DA CONSULT 불요). dedup 상태는 워치독과 공유하는 기존 로컬 JSON(단일 노드 macstudio) → 신규 DB 표면 0. 상태 read 실패 시 이번 사이클 알람 스킵(폭격/유실 둘 다 방지: 300s 재시도 + 워치독 백스톱). 슬랙/상태 write 실패는 비치명(폴러 본업=적재에 무영향). --self-test 10/10 PASS(미등록 TID 주입→즉시 감지·dedup 억제·COALESCE 감지·data.tid=등록건 false-alarm 방지). E2E ef_only(AC-4 재현으로 대체). 대표 게이트 불요(planner AC-4 spinoff 결정문)."
reporter: planner
parent: T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP
option_decision: "Option(b) 채택 — drift 훅 지점 실재 확인(filterToFootScope 가 이미 merchant 인정+미등록 TID 를 산출). Option(a) 워치독 1h 상향 폴백 불요."
commit: b1e6dab3
---

# T-20260727-foot-REDPAY-WATCHDOG-LATENCY-CLOSE

## 배경
부모 T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP AC-4(워치독 latency) spinoff.
워치독(`redpay_terminal_watchdog.mjs` ④ TID-grain 대사)이 '기등록 foot merchant 의
명단-밖 신 TID'(silent-drop)를 잡지만 **일 1회 배치(09:10 KST)** → 인지창 최대 24h.
0725GAP 실측: 신 TID 첫 등장 7/25 오후 → 7/26 09:10 포착 = ~19-24h latency.
부모 맥락 = P0 '실시간 매출 누락' → 인지창 축소가 본질 처방.

## 옵션 판단 (planner AC-4 spinoff 결정문)
- **Option(b) 채택**: 폴러(300s 주기)에 미등록 TID 즉시 알람 훅을 additive 로 얹어
  인지창을 폴러주기로 단축. **실현가능성 확인 완료** — 폴러 `filterToFootScope()` 가
  이미 `drift`(=merchant 인정 + 미등록 TID)를 산출하므로 훅 지점 실재. → 채택.
- Option(a) 워치독 1h 상향 = 폴백. (b) 실현가능 → **불요**.
- Option(c) 현행 daily 수용 = REJECT(planner).

## Acceptance Criteria
1. **인지창 ≤1h**: 폴러(launchd StartInterval 300s)가 매 사이클 drift 를 즉시 알람 →
   인지창 24h → ≤5분. ✅
2. **first_alerted de-dup**: 워치독과 동일 상태파일 alerted_tids 공유 → 슬랙 폭격 방지 +
   폴러/워치독 상호 이중알람 방지. ✅
3. **워치독 일배치=백스톱 유지, biznos 태그[457-23-00938] 무변경**: 워치독 무수정.
   폴러 알람 biznos=REDPAY_BUSINESS_NO(457) 태그. ✅
4. **미등록 TID 주입→즉시 알람 evidence 로그**: `[TID-ALARM-REALTIME]` 로그 + --self-test
   10/10 PASS(미등록 TID 주입 재현). ✅
5. **(b)/(a) 최종 방향+근거 기록**: 본 티켓 option_decision + 배경 절. ✅

## 게이트
- db_change=false / DA CONSULT 불요(데이터 귀속 무접촉) / E2E ef_only(--self-test 대체) /
  risk GO / 대표 게이트 불요.
- 의료게이트 §11.1: 해당 없음(백엔드 폴러 스크립트, 의료 surface 아님).

## 배포
- commit `b1e6dab3` → origin/main ff push 완료.
- 배포 대상 = macstudio launchd `com.obliv.foot.redpay-macstudio-poller`
  (`cd ~/GitHub/obliv-foot-crm && node scripts/redpay_macstudio_poller.mjs`, 300s 주기).
  CF Pages 무관(백엔드 상주 스크립트). 다음 사이클부터 실시간 알람 활성.
- 킬스위치: `REDPAY_POLLER_TID_ALARM_ENABLED=false` (env, 무재배포 비활성).
