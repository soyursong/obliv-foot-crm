# T-20260717-foot-CLOSING-REFUND-STATS-MISSING — RCA 증거 (READ-ONLY)

- 작성: dev-foot / 2026-07-17
- 방식: prod SELECT-only probe (service_role) + 배포본(eb37cef2, pages.dev live) 코드 정독 + 화면 재현
- 코드/DB mutation: **0** (앱코드 무변경, 진단 단계)
- probe 스크립트: `scripts/T-20260717-foot-CLOSING-REFUND-STATS-MISSING_probe{,2,3,4}.mjs`, `_replicate2.mjs`
- 재현 케이스: 차트 F-4840 홍미옥 / 환불 350,000 / 2026-07-17 (planner 제공)

## ⚠ 선행 조정 (REDEFINITION_RISK) — 결론: 별개 경로 → 독립 진행
- 본 티켓 대상 = **일마감(/admin/closing) `Closing.tsx` 직접쿼리** (payments + package_payments + closing_manual_payments, created_at 기준).
- DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE 대상 = **사이드바 통계 `foot_stats_consultant` RPC** (check_ins.consultant_id 기준).
- DAYCLOSE 티켓 RCA 대조표(AC1)가 두 경로가 별개임을 이미 확증. **집계 코드경로 비중첩 → 독립 진행, 상충 없음.**
- REFUND-BACKDATE-NAV-ERROR-HOTFIX(1b8656f5)=PGRST202 스키마캐시 토스트 문구 건, 집계와 무관.

## 핵심 결론 (요약)
**배포본에서 홍미옥 350,000 패키지 환불은 이미 (b)매출 합계·(c)담당자별 매출에서 정상 차감되고 있음.** AC2/AC3는 배포 코드로 이미 충족. 티켓 전제("합계·담당자별 매출 미차감")와 **불일치**. 남은 실질 갭은 (a)목록 표시 방식 — 환불이 별도 빨간 행이 아니라 **원결제행에 병합 annotate**(T-20260715 REFUNDROW REQ② 의도된 설계)로 노출되어, **삼중 중복결제 데이터**와 겹쳐 현장에서 "환불 안 잡힘"으로 인지됨.

## 데이터 실측 (홍미옥 F-4840, package 5ac32b4a, prod)
`packages`: total_amount=350,000 / paid_amount=**700,000** / status=active / total_sessions=1
`package_payments` 4행 (전부 2026-07-17, clinic 종로):
| id | type | amount | method | created_at(KST) | parent | memo |
|----|------|--------|--------|-----------------|--------|------|
| 74600d9b | payment | 350,000 | card | 11:29 | — | 수기수납(패키지 잔금) |
| fca391cd | payment | 350,000 | card | 11:29 | — | 수기수납(패키지 잔금) |
| a5d58ac0 | payment | 350,000 | card | 11:29 | — | 실결제 진행 내역 환불처리(오류)되어 수기로 재업로드 |
| **c0c67cbe** | **refund** | **350,000** | card | **11:31** | **fca391cd** | (null) |

→ 환불행 **존재**·**금일 created_at**·parent 원결제행(fca391cd)도 금일 목록에 존재. 즉 병합·차감 성립 조건 100% 충족.
→ 순액 = 3×350,000 − 350,000 = **700,000** (packages.paid_amount와 일치). ※ 350k 패키지에 700k = 삼중입력·오류환불·재업로드 수작업의 데이터 이상(집계 결함 아님).
- (probe 1·4의 "package_payments 0건"은 존재하지 않는 `status` 컬럼 select 오류로 인한 **probe 아티팩트**였음. package_payments엔 status 컬럼 없음. package_id 기준 재조회로 정정.)

## 배포 코드(eb37cef2) 정독 — 환불 반영 경로 확증
1. **fetch**: `closing-pkg-payments` 쿼리(L336-347)는 status 필터 없이 clinic+created_at(당일)만 → 환불행 포함 fetch. ✓
2. **merge**(L924-946, T-20260715 REFUNDROW REQ②): 환불행을 `merged_refund=true`로 **표시에서만 스킵**, `rows` 배열엔 **잔존**(주석: "합계 reduce 에는 잔존"). 원결제행엔 `refunded=true`·`refund_amount+=350000` annotate. ✓
3. **담당자별 매출**(`staffTotals` L1024-1037): `enrichedRows` 전체(환불행 포함) 순회, `amt = refund ? -amount : amount` → **엄경은에서 -350,000 차감**. ✓
4. **매출 합계**(리스트 footer / SummaryCard): 동일 net reduce → 차감. ✓
5. **환불 후 캐시**: onSuccess가 `refreshPayments()`(payments·pkg·manual invalidate) 호출 → stale 없음. ✓

## 화면 재현 (staff 테이블 정합, `_replicate2.mjs`) vs 스크린샷(15:11)
| 담당자 | 스크린샷 | 재현(현재) | 비고 |
|--------|----------|-----------|------|
| 송지현 | 5,658,800 | 5,658,800 | 일치 |
| 엄경은 | 1,067,600 | 1,077,600 | 홍미옥 담당=엄경은. 환불 미차감 시 ~1,417,600이어야 함 → **차감 반영 확증** (Δ10,000=이후 라이브 입력) |
| 합계 | 7,836,400 | 7,866,900 | Δ30,500=스크린샷 이후 라이브 입력 |

- 홍미옥 담당 staff = **엄경은**(assigned_staff_id b311593d). 환불 -350,000이 엄경은 net에 반영됨.
- RLS: 스크린샷에 패키지 행(패키지 badge, F-4817 5,640,000 등) 정상 노출 → 매니저 세션이 package_payments 읽음, RLS는 payment_type 미필터 → 환불행도 매니저에게 보임.

## AC 판정
- **AC2(합계 차감)**: 배포본 **이미 충족**(코드+prod 재현).
- **AC3(담당자별 차감)**: 배포본 **이미 충족**(엄경은 net에 -350,000).
- **AC1(목록 표시)**: 환불이 **별도 행이 아닌 원결제행 병합 annotate**로 노출(T-20260715 의도 설계). 삼중 중복결제와 겹쳐 현장 인지 실패 가능. → "표시 방식" 이슈이지 "누락" 아님.
- **AC4(회귀0)**: 코드 무변경 → 회귀 없음.
- **AC5(RC 명시)**: 본 문서.

## 왜 현장은 "안 잡힘"으로 봤나 (RC 가설)
1. **표시 설계 인지차**: T-20260715 REFUNDROW REQ②로 **빨간 환불 행이 사라지고** 원결제행 하단 소형 "환불 -350,000" 각주로 대체됨. 과거 빨간 행에 익숙한 매니저가 "환불 표시 없음"으로 인지.
2. **데이터 이상 증폭**: 홍미옥은 350k 패키지에 350k×3 입력 + 1건만 환불 → 순 700k. 환불 1건이 중복 3건 중 1건만 상쇄 → "환불해도 안 줄었다" 체감.
3. **스크롤 오프**: 스크린샷 리스트는 13:04~15:05 구간(하단)만. 홍미옥(11:29)은 상단 스크롤 밖.

## 권고 (착수 전 planner 확인 필요 — 추측 수정 금지 + REDEFINITION_RISK)
집계는 정상이므로 **추측성 집계 수정 금지**. 실질 개선은 AC1 "환불 가시성"인데, 이는 T-20260715 REFUNDROW(병합 annotate) **의도 설계를 되돌리는 방향**이라 단독 변경 시 redefinition. 아래 중 택1을 **김주연 총괄/planner confirm** 후 착수 권고:
- **Opt A (저위험·표시강화)**: 원결제행 환불 annotate를 더 눈에 띄게(빨간 배지/음수 병기 강조) — 병합 설계 유지, 집계 무변경, db 무변경. 회귀 리스크 최소.
- **Opt B (설계 회귀)**: 환불을 다시 별도 음수 행으로 노출 — T-20260715 REFUNDROW 되돌림. redefinition, 총괄 confirm 필수.
- **Opt C (데이터 정정)**: 홍미옥 삼중 중복결제 정정(백필) — data_correction_backfill SOP + DA CONSULT. 집계코드 무관.
