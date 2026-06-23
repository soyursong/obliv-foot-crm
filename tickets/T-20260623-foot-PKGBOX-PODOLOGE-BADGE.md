---
id: T-20260623-foot-PKGBOX-PODOLOGE-BADGE
domain: foot
status: deploy-ready
deploy-ready: true
db_change: false
build_ok: true
spec_added: tests/e2e/T-20260623-foot-PKGBOX-PODOLOGE-BADGE.spec.ts
summary: "대시보드 고객박스에 포돌로게(PD) 식별 배지 추가 — 활성 패키지 중 podologe_sessions>0 고객을 orange [PD] 배지로 표시 (PKG-BOX-INDICATOR 패턴 재사용, DB 무변경)"
implementation_commit: fb557eb9
priority: P2
created_at: 2026-06-23
deployed_at: ""
---

# T-20260623-foot-PKGBOX-PODOLOGE-BADGE

대시보드 고객박스(슬롯 카드)에 포돌로게(PD) 식별 배지 추가. 활성 패키지 중
`podologe_sessions > 0` 인 고객을 `[PD]` 배지(orange, `bg-orange-100 text-orange-700`)로 표시.

## 구현 (additive, DB 무변경)

기존 `pkgHolderSet`(T-20260522-foot-PKG-BOX-INDICATOR) 패턴을 그대로 재사용:

- `PodologeHolderCtx` (createContext<Set<string>>) 신규 + `podologeHolderSet` state
- `fetchPackageLabels` select 에 `podologe_sessions` 컬럼만 추가 → 동일 packages 1쿼리 안에서
  `podologe_sessions ?? 0 > 0` 고객 customer_id 를 `podologeSet` 에 수집. **추가 DB 쿼리 0건.**
  (활성 패키지 배치 150 청킹은 package_sessions 사용량 합산용으로 그대로 유지, podologe 판정은
  packages row 자체 컬럼이라 청킹 불필요.)
- `CheckInCard` compact / non-compact **양쪽** 렌더 블록에서 패키지 배지 바로 뒤에
  `hasPodologe && <span data-testid="podologe-holder-badge">PD</span>` 렌더.
- 색상 충돌 확인: 기존 violet(패키지)/blue·yellow(초진)/indigo(상담실)/amber(주번)/red(우선)/메탈릭(ALT)
  미충돌 → **orange** 채택.

> 참고: 워크인 카드는 칸반에서 `CheckInCard` 를 사용하므로 위 두 블록으로 자동 커버.
> TimelineCheckInCard(타임테이블 카드)는 기존에 패키지 배지를 렌더하지 않으므로 일관성을 위해
> PD 배지도 추가하지 않음(패키지 배지가 표시되는 곳에만 PD 표시).

## AC

- **AC-1**: 활성 패키지 중 `podologe_sessions>0` 보유 고객 카드에 `podologe-holder-badge`(PD) 렌더
- **AC-2**: 포돌로게 회차 없는 패키지(heated만 등) 보유 고객 카드에는 PD 배지 미표시 (패키지 배지는 정상 표시)
- **AC-3**: PD 배지가 orange 계열 — 기존 패키지(violet)/초진 딱지와 시각 구분, 카드 가로 오버플로우 없음

## 현장 클릭 시나리오

1. **포돌로게 10회권 보유 재진 고객 체크인** → 대시보드 칸반 카드에 `패키지` 배지 옆에 주황 `PD` 배지가 함께 뜬다.
2. **heated 10회권만 보유 고객 체크인** → `패키지` 배지만 뜨고 `PD` 배지는 없다.
3. **포돌로게 회차를 모두 소진(잔여 0)했지만 패키지가 아직 active** → podologe_sessions 컬럼이 0이 아니면 PD 표시 유지(보유 식별 기준). 패키지 status가 active 종료되면 자연 소거.

## E2E

`tests/e2e/T-20260623-foot-PKGBOX-PODOLOGE-BADGE.spec.ts` — service_role 시드 패턴(PKG-BOX-INDICATOR 동일):
- S-0: 포돌로게 보유 카드에 PD 배지 렌더 + 텍스트 'PD' (AC-1)
- S-1: PD 배지 orange 계열 스타일 (AC-3)
- S-2: PD 배지 렌더가 카드 가로 오버플로우 유발 안 함 (AC-3)
- S-3: 포돌로게 없는 패키지 카드 → 패키지 배지 O / PD 배지 X (AC-2 음성 회귀)
