---
id: T-20260803-foot-CBAND-PAYRESP-WAIT-TIMEOUT-EXTEND
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-08-03
completed: 2026-08-03
db_changed: false
e2e_spec: tests/e2e/T-20260803-foot-CBAND-PAYRESP-WAIT-TIMEOUT-EXTEND.spec.ts
risk_verdict: GO
risk_reason: "코밴/CAT 직결결제 응답 대기 timeout 규명 + 조건부 연장(INVESTIGATE-THEN-BUILD). AC-1 규명: 25초 대기 timeout 출처 = CRM 클라 상수 CBAND_SEND_TIMEOUT_MS (src/lib/cband/catClient.ts:26). send() 내부 setTimeout(line 155)으로 CRM 이 자기 타이머로 응답 대기를 종료 — 데몬/외부 강제값 아님. 전파체인: CbandPayEntryButton(override 없음) → runPaymentFlow(opts.timeoutMs=undefined) → sender({timeoutMs:undefined}) → catClient.send 의 (opts.timeoutMs ?? CBAND_SEND_TIMEOUT_MS). 이 상수가 단일 출처 → AC-2(CRM설정 BUILD) 분기. AC-2 조치: 25_000 → 45_000. 현장 실측(최필경 총괄): 카드 미투입 시 단말(CAT)이 31~32초에 자가종료 후 결과 전문 반환(7/31 32·32·32·32·31·32 / 8/3 31×8 일관). 종전 25초 < 단말 32초 → CRM 이 먼저 포기하는 어중간 구간 발생. 45초 = 단말 자가종료 최대 32초 + 결과 전문 수신 여유 ~13초(GO_WARN 권장 40~50초, 상한 60초 이내). ★값만 조정 — 성공/실패/타임아웃 판정(classify)·이중결제방지(send-lock/probeConcurrent)·전문 파싱 전부 불변. db_change=false(MIG-GATE 불요), 스키마/RPC/트리거/npm 의존성 무변경. 결제 핵심경로 성공/실패/타임아웃 3분기 회귀: 신규 spec 3(연장 하한 32초 초과 / 상한 60초 이내·확정 45초 / 무응답→ATTENTION 불변) + PLANA BUILD spec 49 회귀 = 52 passed. 인접 PLANA(이중결제방지)·PAYBTN(6상태) 회귀 무영향 확인. 실 단말 field-soak(카드 미투입 시 단말 자가종료 결과 정상 수신) = 총괄(최필경) 실기기 confirm."
author: dev-foot
build_verified: "2026-08-03 — vite build ✓ built in 6.42s / playwright unit 52 passed (신규 3 + PLANA BUILD 회귀 49), 0 failed"
followups: []
---

# T-20260803-foot-CBAND-PAYRESP-WAIT-TIMEOUT-EXTEND

## 요청 (planner NEW-TASK, MSG-20260803-125957-vs1s)
코밴/CAT 직결결제 응답 대기 timeout(현재 25초) 규명 + 조건부 연장 (INVESTIGATE-THEN-BUILD).
현장 실측: 단말은 카드 미투입 시 31~32초에 자가종료하고 결과를 반환 → CRM 25초 < 단말 31초 → CRM 이 먼저 포기(어중간 구간).

## AC-1 규명 결과 (BLOCKING·먼저) — CRM 클라 상수
| 항목 | 값 |
|------|----|
| 출처 | **CRM 클라이언트 상수** (데몬/외부 강제값 아님) |
| 파일·라인 | `src/lib/cband/catClient.ts:26` |
| 상수 | `export const CBAND_SEND_TIMEOUT_MS = 25_000;` |
| 종료 메커니즘 | `send()` 내부 `setTimeout(() => finish(null, true), timeoutMs)` (line 155) — CRM 이 자기 타이머로 응답 대기를 종료(client-side abort). 데몬은 이 값을 모름. |
| 전파 체인 | `CbandPayEntryButton`(override 없음) → `runPaymentFlow(opts.timeoutMs=undefined)` → `sender({timeoutMs:undefined})` → `catClient.send`의 `opts.timeoutMs ?? CBAND_SEND_TIMEOUT_MS` = 25_000. **이 상수가 단일 출처.** |

→ CRM 설정이므로 **AC-2(BUILD) 분기**.

## AC-2 조치 (CRM설정 → BUILD) — timeout 값만 연장
| 파일 | 변경 |
|------|------|
| `src/lib/cband/catClient.ts` | `CBAND_SEND_TIMEOUT_MS` **25_000 → 45_000** + 근거 주석 갱신. |
| `tests/e2e/T-20260803-...-PAYRESP-WAIT-TIMEOUT-EXTEND.spec.ts` (신규) | ①연장값이 단말 자가종료(32초) 초과 ②60초 상한 이내·확정 45초 ③무응답→classify ATTENTION 불변 회귀. |

- 45초 = 단말 자가종료 최대 32초 + 결과 전문 반환 수신 여유 ~13초. GO_WARN 권장 40~50초대, 상한 60초 이내.
- ★결제 성공/실패/타임아웃 판정·이중결제방지(send-lock/probeConcurrent)·전문 파싱 = 전부 불변. **timeout 값만.**

## 검증
- build: `vite build ✓ built in 6.42s`
- unit(playwright): **52 passed** (신규 3 + PLANA BUILD 회귀 49), 0 failed
- db_change=false (MIG-GATE 불요)
- 실 단말 field-soak(카드 미투입 시 단말 자가종료 결과 정상 수신) = 총괄(최필경) 실기기 confirm

## AC-4 현장 회신 (planner FOLLOWUP → responder 경유 최필경 총괄)
- (a) 25초 출처: **CRM 프로그램 자체 설정값**이었습니다(단말기가 정한 값 아님). CRM 이 25초까지만 기다리고 스스로 끊고 있었습니다.
- (b) 조치결과: 기다리는 시간을 **25초 → 45초로 늘렸습니다.** 단말기가 카드 미투입 시 31~32초에 스스로 끝내고 결과를 돌려주므로, 이제 CRM 이 먼저 포기하지 않고 그 결과를 받습니다.
