---
id: T-20260606-foot-PENCHART-PHRASE-INSERT-FIX
domain: foot
status: resolved-by-duplicate
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX.spec.ts
e2e_spec_exempt_reason: "동일 RC·동일 코드패스 — 별건 spec 신규 불필요. 공유 RC를 sister spec 13케이스가 이미 커버."
qa_result: pending
deploy_commit: 18befa6
created: 2026-06-06
slack_thread_ts: "1780731431.455099"
resolved_by: T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX (commit 18befa6)
---

# T-20260606-foot-PENCHART-PHRASE-INSERT-FIX — 펜차트 상용구 ✓ 선택 후 미삽입

## 요청 (김주연 총괄 재신고, P1)
펜차트(PenChartTab) 상용구 패널에서 '재진(PD)[증상경과]' 행 ✓ 선택했으나 캔버스에 미삽입.
첨부: 164308_direct_20260606_162106.png (✓ 선택 상태), 164405 재신고.

## RC 규명 (read-only 조사, 추정 없음)

### 동선
✓ 클릭 → `insertPhraseImmediate` → `handleBoilerplateSelect(content)` → `pendingBoilerplate` 세팅
+ `activeTool='boilerplate-placing'` 진입 → **캔버스 탭 시** `onPointerDown` → `placeBoilerplate()` 로 PlacedItem 배치.
(설계상 ✓는 "배치 모드 진입", 실제 삽입은 캔버스 1탭. a16193f AC-3 인라인 배지 "탭하여 배치"로 안내.)

### 진짜 원인 = boilerplate-placing 동선의 touch guard 차단
`onPointerDown` 첫 줄 `if (e.pointerType === 'touch') return;` 가 boilerplate-placing 배치 체크보다
**위**에 있어, iPad 손가락 탭이 guard에서 전면 return → `placeBoilerplate()` 진입 자체 차단 → "미삽입".
(Apple Pencil = pointerType 'pen'은 guard 통과하므로 펜슬로는 배치됐음 → 손가락 탭에서만 재현.)

### 조사 포인트 답변
1. **회귀 후보 T-20260522-PENCHART-TOOLS-V3(7d7a9eb) / a16193f 검증 → 둘 다 RC 아님.**
   git log -S 추적 결과:
   - touch guard `pointerType==='touch') return` 도입 = **b9cd022** (T-20260522-PEN-OFFSET+SCROLL-BLOCK, 2026-05-22 **00:31**)
   - boilerplate-placing 배치 체크 도입 = **0307052** (T-20260522-TOOLS-V2, 2026-05-22 **15:26**)
   - 즉 guard가 먼저(00:31) 생기고, 그 **아래**로 placing 체크가 나중(15:26) 추가됨.
   → **boilerplate-placing이 태어난 5/22 그 순간부터 손가락 탭 배치는 한 번도 동작한 적 없음**(처음부터 UX 단절).
   - a16193f(6/5 ✓즉시삽입 UX전환)는 guard 위치를 **건드리지 않았음**(a16193f~1에서도 guard가 placing 앞에 동일 위치). sister 커밋의 "a16193f 회귀" 표기는 RC 시점 오인 — 실제는 5/22 since-birth 버그. (수정 라인 자체는 정확.)
   - 6/6에 표면화된 이유: a16193f UX전환으로 ✓→손가락 탭 동선이 일상화되며 비로소 다발 신고.
2. **T-20260603-TIMETABLE-NOW-AUTOSCROLL(1692e6a) PenChartTab diff = 0줄** — 동시빌드 회귀 배제 확정(git show --stat에 PenChart 미포함).
3. **범위 = phrase-agnostic.** RC가 공유 `onPointerDown` touch guard(상용구 텍스트 무관)이므로
   '증상경과'·'초진KOH' 등 **전 카테고리 모든 상용구가 동일하게 차단**됐고, 단일 fix가 전부 균일 해소.

## 조치 = sister 티켓과 단일 fix 공유 (별도 코드변경 없음)
RC가 T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX와 **완전 동일**(동일 컴포넌트·동일 onPointerDown·동일 guard).
→ planner 권장("두 티켓 한 번에 fix")대로 **commit 18befa6 단일 수정이 본 건도 해소**:
```
-  if (e.pointerType === 'touch') return;
+  if (e.pointerType === 'touch' && activeTool !== 'boilerplate-placing') return;
```
boilerplate-placing 모드에선 손가락 탭도 통과 → placeBoilerplate 진입 허용. 그 외 모드는 스크롤 전용 불변.

## 검증
- 18befa6 **이미 origin/main 반영 + push 완료**(Vercel 자동배포).
- 최신 main 기준 typecheck(tsc -p tsconfig.app.json --noEmit) **EXIT 0**.
- E2E: sister spec(RX-PHRASE-TOUCH-INSERT-FIX.spec.ts) 13케이스가 boilerplate-placing touch 통과/일반 드로잉 touch 차단 회귀 모두 커버.
- 잔여: 현장 iPad 손가락 탭 실삽입 확인(AC-3 현장검증) — slack_thread_ts 1780731431.455099 회신 매핑.

## MedicalChartPanel(텍스트 진료차트)는 무관
텍스트 진료차트의 인라인 ✓(T-20260605-RX-PHRASE-CLICK-INSERT, 9f57699)는 별도 컴포넌트·concat 방식(캔버스 탭/터치 guard 무관) → 본 RC 영향 없음.
