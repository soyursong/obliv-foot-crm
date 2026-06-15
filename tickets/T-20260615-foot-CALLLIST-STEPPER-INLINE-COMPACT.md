---
id: T-20260615-foot-CALLLIST-STEPPER-INLINE-COMPACT
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: ee29e56cade8
deployed_at: 2026-06-16T00:00:00+09:00
bundle_hash: pending-vercel-auto
summary: 진료콜 명단 "지하철 표시"(단계 노선도) stepper 콤팩트화 — 노드 라벨 4개→점만+현단계 텍스트, 카드 세로높이↓·긴이름 wrap 해소
reporter: 김주연 총괄
assignee: agent-fdd-dev-foot
created: 2026-06-15
---

# T-20260615-foot-CALLLIST-STEPPER-INLINE-COMPACT — 진료콜 명단 노선도 stepper 콤팩트화

## 배경 / 현장 요청

현장(김주연 총괄): "진료콜 명단 한 명이 칸을 너무 크게 차지. 지하철 표시를 배지 옆으로 이동해 공간 낭비 줄여줘. 진료대기 다수일 때 가독성 고려."

- "지하철 표시" = `DoctorStageStepper`(진료 단계 노선도(지하철형) 4단계 stepper).
- 직전 `T-20260615-foot-CALLLIST-SUBWAY-BADGE-INLINE` 이 stepper 를 이름·배지 줄로 인라인 이동했으나, 노드 라벨 4개(대기/원장확인/진료중/진료완료)가 동시 노출돼 폭이 넓고 세로(▼+점+라벨 ~38px)가 커 다수 행에서 여전히 칸을 크게 점유. 긴 이름 행은 stepper 가 다음 줄로 wrap.

## REDEFINITION (policy_superseded)

T-20260614 DOCCALL-PURPLE-STEPPER 이슈2가 "stepper 가로폭 필요 → 전용줄(라벨 4개 노출)" 로 결정한 것을, 동일 reporter(김주연 총괄) 명시 요청으로 갱신. 그 기술근거(라벨 wrap 가독성)는 실재 → "단순 인라인(라벨 4개 그대로)" 금지, compact(현단계 텍스트)로 식별성 가드(AC-2 준수).

## 변경 (렌더 레이아웃만 — DB·EF·비즈로직·신규패키지 0)

- `DoctorStageStepper` 에 `compact?: boolean` prop 추가.
  - compact: 노드 하단 라벨 4개 미렌더(점만) + 점 묶음 우측에 "현 단계만 텍스트" 1개 라벨(`doctor-stage-current-label`).
  - ▼ 현위치 마커(`doctor-stage-here`) 유지. 연결선 폭(w-4→w-2)·mb(13px→7px) 콤팩트 보정(점 중심 정렬).
- `DoctorCallListBar` 행에서 `<DoctorStageStepper ... compact />` 로 렌더.
- `setDoctorStage` / `deriveDoctorStage` / 4노드 클릭전환 / check_ins UPDATE / realtime 동기 일체 미접촉.

## AC 결과

- AC-1 행 세로높이 명확 감소 — replica render(760px): 88/88/88/**114**px(긴이름 wrap) → 균일 **76px**. 노드 라벨 전용 표기 소멸. ✅
- AC-2 다수 시 이름·현재단계 식별 — ▼ 현위치 유지 + 현단계 1개 텍스트 라벨 노출. ✅
- AC-3 4단계 클릭전환 + DB write + realtime 불변 — setDoctorStage/deriveDoctorStage 미변경(spec 박제 PASS). ✅
- AC-4 이름→차트·메모·행숨김·드래그·배지·testid 불변(spec PASS). ✅
- AC-5 브라우저 렌더 확인 — 1명/4명+ 두 케이스 replica 렌더 확인(긴 이름 포함 동일 줄, wrap 해소). ✅

## §6 현장 클릭 시나리오 (E2E 매핑)

- S1 1명(정상) → DOM: 행 stepper compact(4노드·▼ 1개·현단계 텍스트 1개, 노드 라벨 부재).
- S2 4명+(다수) → DOM: 각 행 compact 일관 + name-row 인라인 + 레이아웃 무파손.
- S3 단계 클릭전환 → 소스: setDoctorStage/deriveDoctorStage 박제 불변.

## 검증

- 빌드: `npm run build` OK (무관 WIP KohReportTab.tsx stash 후 검증 — 본 커밋 3파일 type-clean).
- E2E: `tests/e2e/T-20260615-foot-CALLLIST-STEPPER-INLINE-COMPACT.spec.ts` — 4 pass / 2 DOM graceful-skip(당일 진료콜 데이터 0).
- commit: ee29e56cade8 → main push → Vercel 자동 배포.
