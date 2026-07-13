# T-20260713-foot-CI-E2E-RED-DIAGNOSE — RC 규명 + 로컬 재현 검증 (evidence)

- 대상 커밋: main `33c7b056` (진단 착수 시점 7a0e69b4 이후 fix 3종 landed)
- 실패 job(진단 전): 🧪 Critical Flow specs + 🗂️ Chart Open Gate specs
- PASS job(무회귀 유지): Build · TypeCheck · 🔒 Chart Access Lock
- billing 무관 확정: rerun 재현 → 코드/스펙 레벨 실패. billing 인프라 아님.

## RC 분류 — **(B) 스펙/하니스 drift** (앱 회귀 아님). 마스킹 없음.

07-02~13 billing 차단기 기간 CI 무가동 중 축적된 3건 모두 **하니스·env·테스트 결정성** 결함이며, 현장 앱 동선을 깬 앱 회귀(분류 A)가 아니다. AC2(마스킹 금지) 준수 — 실회귀를 스펙 완화로 덮은 것이 아니라, 어긋난 하니스를 실동작 계약에 맞춰 정정.

### RC#1 — helpers.ts env 계약 drift (양 job 동시 RED의 1차 원인)
- 커밋 `ba5be5b9`.
- ac079546(TESTCRED-FIXTURE-CLEAN)가 helpers.ts 평문 폴백을 hard-throw로 교체하며 `TEST_USER_*` 폴백을 helpers.ts 에는 누락. CI는 secrets를 `TEST_USER_EMAIL/TEST_USER_PASSWORD`로 주입하나 helpers.ts는 `TEST_EMAIL/TEST_PASSWORD`만 읽음 → 모듈 로드 시 throw.
  - critical-flow: `TEST_PASSWORD env required` throw.
  - chart-open-gate: 수집 크래시 → `No tests found`.
- FIX(마스킹 아님, auth.setup.ts 계약과 동일화): `TEST_EMAIL = TEST_EMAIL ?? TEST_USER_EMAIL ?? default`, `TEST_PASSWORD = TEST_PASSWORD ?? TEST_USER_PASSWORD ?? throw`(평문 폴백 미복원).

### RC#2 — chart-open-gate G3/G4 auto-noshow skip 가드 enum 오타 (false RED)
- 커밋 `4bf6d469`.
- skip 조건이 `status === 'noshow'`(하이픈 없음)였으나 실제 enum은 `no_show`. 과거 confirmed 예약이 라이브 shared-DB에서 auto-noshow로 뒤집히면 타임라인에서 제외(카드 소멸)되는데, skip이 절대 안 걸려 **환경 요인이 거짓 RED**를 냄.
- FIX: `'noshow' → 'no_show'` + waitFor 통과 후 click 직전 소멸까지 try 가드에 포섭(`clickPastCardOrSkipOnAutoNoshow`).
- **마스킹 아님 근거**: 실제 회귀 라인(`onReservationSelect={!isPast ? ... : undefined}` = 6/6 재발 코드)은 G6 정적 가드(G6-1/2/3)가 하드락. 행위 G3/G4의 auto-noshow skip은 시드 무력화(환경)일 때만 발동하는 defense-in-depth이며 회귀 은폐 경로가 아님.

### RC#3 — 두 job shared-DB QA-FIXTURE 스윕 레이스 (교대성 하드 RED)
- 커밋 `8639ce92`.
- critical-flow + chart-open-gate가 동일 shared-DB(rxlomoozakkjesdqjtvd)에 `[QA-FIXTURE]`를 write하고 global-teardown `cleanupAll()`이 마커 전수 스윕. 두 job이 `needs:[build]` 병렬 실행 시 한 쪽 스윕이 다른 쪽 in-flight 시드(G3/G4 어제 예약)를 삭제 → 카드 소멸 → resvStatus≠no_show → skip 미발동 → 교대성 RED.
- FIX: chart-open-gate `needs: [build, critical-flow]`로 직렬화 → 동시 스윕 원천 차단.

## 로컬 재현 (맥스튜디오 Playwright, HEAD 33c7b056)

```
chart-open-gate  : 9 passed (19.1s)   # G1~G6 전수
critical-flow    : 13 passed (18.5s)  # CF-1~CF-5
Chart Access Lock: ✅ PASS (필수 심볼 0종 클린)
TypeCheck        : tsc -b --noEmit → 0 err
Build            : qa_build.sh → RESULT: OK
```

## 결론
- AC1(RC 규명): 분류 **B** 확정, 3건 세부 근거 기록.
- AC2(마스킹 금지): 준수 — 앱 경로 무변경, 하니스만 실동작 계약에 정합화. 회귀 라인은 G6 정적 가드로 여전히 하드락.
- AC3(최종 초록): 5개 job 로컬 전수 PASS, Build/TypeCheck/Chart Access Lock 무회귀.
- AC4(evidence): 본 문서 = 로그 발췌 + RC 분류(B) + 수정 diff 요약(commit 3종) + 로컬 재현 PASS.
- refund 경로 무접점 → PAY-REFUND(f6277769) reopen 불요.
- fix 3종은 이미 origin/main 반영(ba5be5b9 / 4bf6d469 / 8639ce92). 다음 push CI에서 2 job 초록 확인 예정.
