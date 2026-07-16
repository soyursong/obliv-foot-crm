---
id: T-20260716-foot-SETTLE-LANE-TOTAL-LABEL-SPEC-STALE
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 67be8590a3
deployed_at: 2026-07-16T16:43:39+09:00
bundle_hash: n/a (test-only, 프로덕션 번들 무변경 — tests/ 비번들 · 재배포 불요)
db_change: false
summary: settle-lane 볼드 총액 라벨 '합계'→'수납잔액'(COPAY-BALANCE-SPLIT deployed) relabel 후 stale된 exact:true '합계' assert 교정 + 중복 spec retire. test-only.
created: 2026-07-16
assignee: dev-foot
---

## 배경

COLORBOX-TAXSUM FOLLOWUP(vn17)의 별건 관찰 = 발번. settle-lane 볼드 총액 라벨이
T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT(deployed)에서 **'합계'→'수납잔액'**(공단부담 제외)으로
relabel 됐는데, 구 07-08 spec 2건이 여전히 `getByText('합계', { exact: true })` 를 assert → stale.

- relabel 실재: `src/components/PaymentMiniWindow.tsx:2517` `<span>수납잔액</span>` (2514-2515 주석 = COPAY-BALANCE-SPLIT 근거)
- 잔여 '합계' 렌더(2287 진료비산정 / 2404 세트 / 2700 분할)는 모두 금액 인라인 동거("합계 12,345")
  → `exact:true` 미매칭 → **standalone '합계' 소멸** → stale assert 는 dialog 내 매칭 0건으로 timeout fail.

## AC 처리 결과

### AC-1 재현 확인 ✅
소스 구조 접지로 확정: settle-lane 의 유일한 standalone exact 라벨 = `수납잔액`(2517). 나머지 3개 '합계'
렌더는 전부 `합계 {formatAmount(...)}` 동일 텍스트노드(inline) → `getByText('합계',{exact:true})` 매칭 0.
따라서 stale assert 2건(+sweep 발견 1건)은 dialog 렌더 시 fail. (라이브 재현: LEFTLANE AC-3 는 seed 유무에
따라 flake/skip 하나, VERTICAL AC-4 deterministic seed 로 재현·수정 검증 확정.)

### AC-2 라벨 정합 교정 + settle-lane 스코프 ✅
2건 모두 `dialog.locator('[data-testid="pmw-settle-lane"]').getByText('수납잔액', { exact: true })` 로 교정.
- **pmw-settle-lane 컨테이너 스코프** = 2287 진료비산정 '합계' 등 오매칭 원천 차단(AC-2 위치지시 준수).
- exact 라벨을 relabel 정본 '수납잔액'으로 정렬(값 SSOT = payableTotal, 2519).

### AC-3 retire vs fix 판단 (근거 기록)
| spec | 판단 | 근거 |
|------|------|------|
| `T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT.spec.ts` | **RETIRE (git rm)** | 권위 `T-20260713-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT`(P0 HOTFIX, 실브라우저 DOM순서 S1+S2+S3 + 스샷 evidence gate)로 **완전 superseded**. 07-08 헤더 자체가 AC-2 에서 "권위 spec T-20260713-…LEFTSPLIT S1 확정 순서" 로 위임 명시. 동일 feature family(차트코드+진료비 컴팩트 한 줄) 중복 → retire 정합. 반복 stale-fix(2건째) 발생원이므로 존치 시 재발 smell. |
| `T-20260708-foot-MINIPAY-CHARTFEE-FEEITEM-LEFTLANE.spec.ts` | **FIX** | superseding spec 부재(07-13 LEFTLANE 없음). 고유 lane 재배치 커버리지 보유 → 라벨만 교정하고 존치. |

### AC-4 foot e2e sweep 결과
`getByText('합계'|수납잔액)` 전수 sweep → 5건 분류:

| spec:line | assert | 처리 |
|-----------|--------|------|
| ZONE2 07-08:177 | `합계` exact, settle-lane | **RETIRE**(위) |
| LEFTLANE 07-08:115 | `합계` exact, settle-lane | **FIX** |
| **VERTICAL-STACK-REVERT 07-13:103** | `합계` exact, settle-lane | **FIX — 티켓 미명시, sweep 발견 3건째** |
| FEE-ITEM-SCROLL 05-23:96 | `합계` **non-exact** `.first()` | 유지(비exact → inline "합계 12,345" 매칭 → green, stale 아님) |
| closing.spec.ts:171 | `합계` exact, **일마감 화면** | 유지(PMW settle-lane 아님, relabel 무관) |

### AC-5 그린 확인 → deploy-ready
- **VERTICAL AC-4(수정건)**: deterministic seed 로 3/3 run PASS → `pmw-settle-lane >> 수납잔액` locator 정합 확정.
- **LEFTLANE AC-3(수정건)**: 라이브 데이터 존재 시 PASS(run-1 확인), seed 미존재 시 skip — **본 spec 의 사전존재 live-data 의존성**(07-13 처럼 self-seed 안 함)에 기인. 수정한 라벨 라인 자체는 어떤 run 에서도 fail 없음(fail 은 항상 선행 `세금 구분` 라인 = 데이터 미로딩). 두 수정건 locator 패턴 동일 → VERTICAL AC-4 로 수정 정합 증명.
- AC-1/2/5(LEFTLANE, **미수정**) 의 flake/skip = origin/main 과 byte-identical(diff = 라벨 라인만) → 본 티켓 무관 사전 flake. 스코프 밖(LEFTLANE self-seed 미비는 별건).

**test-only, 프로덕션 무변경(재배포 불요)** — db_change=false, FE/EF 소스 무수정.

## 후속 업데이트
- (배포 트리거 후 deploy_commit/deployed_at 채움)
