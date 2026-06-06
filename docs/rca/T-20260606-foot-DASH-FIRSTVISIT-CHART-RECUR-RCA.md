# RCA — 대시보드 초진 고객차트 안열림 만성 6차 재발

- 티켓: T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA
- 작성: dev-foot, 2026-06-06
- 상태: 코드 fix 배포 완료(3b825c8, field-soak) + 본 RCA 보고

## AC-1 — 재현 경로 (1줄 특정) + 복구

**깨지는 정확한 경로**: 대시보드 **통합시간표(Timeline) 뷰 → '체크인 전 초진 명단' 슬롯 아코디언**에서 초진 카드/이름 클릭 시 차트 미오픈(에러·빈화면 없는 silent fail). 24/7 태블릿이 자정을 넘겨 `date` state가 어제로 stale → `isPast=true` → 타임라인 `onCardClick`이 `undefined`로 묶여 클릭 자체가 죽음. (칸반 뷰는 항상 `handleCardClick` 직결이라 정상 → "칸반OK·타임라인dead"의 정체.)

**복구**(이미 배포):
- `src/pages/Dashboard.tsx` L6160 `onCardClick={handleCardClick}` — 타임라인 `!isPast` 게이트 제거(차트 열기는 read-only). L6161 `onCardContext={!isPast ? ...}` — mutation만 isPast 유지.
- L6163 `onNameOpen={handleNameChartOpen}` + L4997 핸들러 — 아코디언 명단 이름 클릭에 차트열기 배선. `customer_id=null`(신규초진 흔함)도 이름 fallback(동일 클리닉·동명 1건 자동 열기)으로 오픈.
- 자정 롤오버(`dateUserPinnedRef`+`isSameDay`)로 stale date 재발 차단.

## AC-2 — 왜 5/19 guard(CHART-ACCESS-LOCK)가 이 회귀를 못 막았나 (증거 기반 판정)

5/19 guard 실체 = **심볼 존재 여부만 보는 스캐너**:
- `scripts/check-chart-access-lock.sh` + `scripts/chart-access-lock.json` (10개 required_patterns)
- `.git/hooks/pre-push` + `.github/workflows/ci-push.yml` job `chart-access-lock` 에서 실행됨
- Dashboard.tsx에 대한 유일 패턴 `CHART-LOCK-009` = 파일 어딘가에 문자열 `openChart`가 **존재**하는지만 grep.

### 판정: 3원인 모두 성립, 주범은 (c) 구조 드리프트

**(c) 구조 드리프트 — PRIMARY [증거 확정]**
- 차트 오픈 경로가 **두 갈래 caller 체인**으로 분기됨: 칸반(DraggableBox1Card/Box2ResvCard.onSelect, handleReservationSelect) vs **통합시간표(DashboardTimeline → onCardClick/onReservationSelect/onNameOpen)**.
- CRITICAL `DO NOT MODIFY` 주석은 칸반 caller(Dashboard.tsx L1536/L1610/L4951) + ChartContext(`src/lib/chartContext.ts`) + 렌더 단일출처(AdminLayout.tsx)에만 존재. **통합시간표 caller 체인엔 guard 주석이 단 한 줄도 없었다.**
- 회귀는 타임라인 `onCardClick`에 `!isPast` 래퍼를 둘렀을 뿐 `openChart` 심볼·guard 라인은 손대지 않음 → 스캐너 GREEN 유지.
- 재확인: `bash scripts/check-chart-access-lock.sh` = 이 회귀가 살아있던 코드에서도 **PASS(클린)**. 심볼 존재 스캐너는 "primitive가 있다"는 증명일 뿐 "모든 caller가 올바로 배선됐다"는 증명이 못 됨.

**(a) E2E 시나리오 갭 — CONFIRMED 기여**
- `tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts`의 AC-1/AC-2는 `box1-resv-card`/`box2-resv-card`(**칸반**)만 클릭. 유일한 타임라인 테스트 AC-5-7은 **렌더만** 검증, click→open 없음.
- 즉 "통합시간표 초진 명단 클릭 → 차트 오픈" 동작을 검증한 E2E가 처음부터 없었음. guard E2E가 돌았어도 깨진 경로를 클릭하지 않으니 통과.

**(b) CI/pre-push 게이트 — 작동하나 사각 [증거 확정]**
- 게이트는 배선·작동함(pre-push hook + ci-push.yml `chart-access-lock` job). **단** 실행 대상은 (i) 심볼 스캐너(위 c로 무력) + (ii) `tests/e2e/critical-flow/`(CF-1~CF-5)뿐. `ci:push` = `typecheck && build && test:critical`.
- CHART-OPEN-GUARD.spec.ts는 `tests/e2e/` 루트 → **머지 차단 게이트에 포함 안 됨.** 행위 기반 guard spec이 블로커로 돌지 않음.

## AC-3 — 재발방지 개선방향 (구조적 원인 + 개선안)

**구조적 원인**: 차트 오픈에 **칸반 / 통합시간표 두 개의 병렬 진입점**이 존재하고, 둘이 `ctxOpenChart` primitive만 공유한 채 onClick→handler 배선을 **각자 따로** 한다. 재발 방지 guard는 primitive 존재만 확인하는 **심볼 스캐너**라, 한 진입점이 무심코 게이팅/조건 추가로 죽어도(다른 진입점이 멀쩡하면) 아무것도 트립되지 않는다. 게다가 행위 기반 E2E가 머지 게이트 밖이라 안전망도 작동하지 않는다. → "한 뷰는 배선·다른 뷰는 dead"가 6번 반복된 근원.

**개선안**:
1. **[완료·본 티켓 AC-4]** guard E2E 매트릭스 보강 — RCA spec(`tests/e2e/T-20260606-...-RECUR-RCA.spec.ts`) AC-A/C/GUARD 10/10 pass. 타임라인 초진 명단 onClick·null customer_id·자정 롤오버·isPast 게이트 제거를 영구 고정.
2. **[별도 티켓 제안]** chart-open **행위 기반 E2E(타임라인+칸반 click→open, 초진/재진×접수전후)**를 CI push **머지 차단 게이트**(현재 critical-flow만)로 승격. 심볼 스캐너 단독으로는 caller 배선 드리프트를 못 잡음. (게이트 정책 변경 → supervisor GO 필요)
3. **[별도 티켓 제안 — 진짜 근본해결]** 차트 오픈 **진입점 단일화** 리팩터. 타임라인·칸반이 공통 `openChartFor(card|reservation|name)` 하나만 호출하도록 통합 → "한 뷰만 배선" 클래스 제거. 6차 재발의 항구적 해법이나 실제 리팩터 → 별도 티켓(본 핫픽스 RCA에서 임의 대형 리팩터 금지 원칙 준수).

## AC-4 — guard E2E 보강 + 전수통과

- RCA spec 정적부 10/10 PASS, build OK(3.49s), guard 스크립트 PASS, db_change=false.
- 초진/재진 × 접수 전/후 + 통합시간표 명단 onClick 케이스 커버.
