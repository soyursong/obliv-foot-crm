---
id: T-20260730-foot-SOLAPI-AUTORECHARGE-DOUBLECHECK-RETUNE
domain: foot
status: deploy-ready
priority: P2
parent: T-20260729-foot-SOLAPI-AUTORECHARGE-FAIL-ALERT
deploy_ready_by: dev-foot
deploy_ready_at: 2026-07-30
db_change: false
ddl: none
risk_verdict: GO
build_status: n/a(standalone node worker, non-FE bundle)
e2e_status: exempt(deps=solapi-live, UI=0) — self-test 44+ assertions PASS
scenario_ref: MQ MSG-20260730-175120-mq2w (A/B/C)
medical_confirm_gate: n/a
---

# T-20260730-foot-SOLAPI-AUTORECHARGE-DOUBLECHECK-RETUNE

부모 T-20260729-foot-SOLAPI-AUTORECHARGE-FAIL-ALERT(deployed)의 **실효 파라미터 재정합 + 직접 검증 추가**. 중복 재구현 아님. 기존 launchd 워커(`com.obliv.foot.solapi-balance-monitor`) additive.

## 왜 (구조적 오탐 위험)
CEO 실측 확정: 자동충전 = **잔액 < 10,000원 → 100,000원 충전**(autoRecharge 사실상 ON). 그런데 부모 프록시는 트리거를 종로15만/송도5만으로 **추정(guess)** → 정상 충전 후 잔액(10만원대)이 항상 임계 아래 → autoRecharge ON 순간 **오탐 폭주** 위험.
(※ 참고: origin/main D-1 정합으로 하드코딩 트리거는 이미 10,000 으로 낮춰짐. 본 티켓은 그 위에 API-driven 소스화 + 직접 더블체크 + (5)번 억제 + 사각 보강을 얹는다.)

## 라이브 probe 발견 (2026-07-30 dev-foot, READ-ONLY)
`scripts/T-...cashlog_feasibility_probe.mjs` 실호출 결과:
- 솔라피 `/cash/v1/balance` 가 자동충전 실제 설정을 **직접 노출**:
  - `minimumCash = 10000` (자동충전 트리거 — CEO 값 일치)
  - `rechargeTo = 100000` (자동충전 목표잔액 — CEO 값 일치)
  - `rechargeTryCount` (솔라피 자체 자동충전 시도 카운터 — 카드결제 실패 시 증가)
- 충전내역(cash/payment history) API는 **부재** — `cash/v1/history`·`point/history`·`payment/history` 전부 **404 실증**.
- 활성 지점 = 송도(b4dc0de5) 1곳. 실측 balance=442,871원 / autoRecharge=1 / rechargeTryCount=0 (정상).

## 구현 (A/B/C)
파일: `scripts/solapi_balance_quota_monitor.mjs` (feature 6 재정합)

- **A. 실효 파라미터 재정합**: 트리거 = `env override > balance.minimumCash(실측) > default(10,000)` (`resolveTrigger`). 목표잔액 = `env > balance.rechargeTo > default(100,000)` (`resolveRechargeTo`). 하드코딩 drift 제거 — 콘솔에서 트리거 변경 시 코드 수정 없이 자동 정합.
- **B. 결제/캐시 API 직접 더블체크**: history API 부재 → balance API의 `rechargeTryCount`로 대체한 **2단 교차검증**.
  - ① 프록시(balance-recovery): autoRecharge ON & 잔액 < 트리거 & grace 2폴링 내 미회복.
  - ② 직접(rechargeTryCount): 시도 카운트 > 0 = 카드결제 실패 정황.
  - 2신호 동시 → **즉시 확정**(grace 생략, 미탐 최소). 프록시만 → grace 후.
  - 사각 보강: 반복실패로 autoRecharge가 자동 OFF된 상태(OFF & tryCount>0 & 잔액<트리거)도 감지.
- **C. 실패 알림 형식 + 오탐 0**: parent ③ 톤/형식 `buildAutoRechargeAlertText`(현재잔액·트리거·충전예정액·교차검증 라인·지점라벨·24h 재경보 억제). autoRecharge ON 시 (5)번 절대 원(₩) 임계 경보를 **억제**(grace 없어 pre-recharge dip 단발 오탐 → OFF 계정 전용).

## AC 검증
- **AC 핵심(오탐 0)**: 라이브 dry-run(autoRecharge ON, 잔액 44만) → `breached=false, bal_alerts=0`. `dryrun_live_normal.out`.
- **진짜 실패만 감지**: self-test — 프록시-only/2신호/OFF사각 3케이스 breached + 정상 ON/OFF 미발동. `selftest.out` (44+ assertions PASS).
- **문안**: 3케이스 렌더 evidence + 현장 언어 게이트(개발용어 0건) 통과.
- **feasibility(B)**: `cashlog_feasibility_probe.out` — history API 404 실증, rechargeTryCount 채택 근거.

## 게이트
- risk 5/5 = GO. DB0 · no-DDL · read-only 폴링 · 비즈로직 무접촉(관측만) · 신규 lib 0.
- e2e 면제(deps=solapi-live, UI=0) → self-test 순수함수 단위검증으로 AC 커버.
- 현장 통보 = parent 게이트 승계, **지금 알림 금지**(QA/실효 확인 후 planner 재조율).

## ball
supervisor: QA → merge → arm(launchd는 이미 상주, 코드만 갱신). launchd 재등록 불요(다음 :20 주기 자동 반영).
