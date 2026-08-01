# T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — READ-ONLY 재개 census evidence (REGRAIN)

- prod: rxlomoozakkjesdqjtvd | 2026-08-01 | mutation=0 (READ-ONLY, dry-run No-Persistence)
- DA GO: DA-20260801-foot-F4741-RECORD-REMOVE-REGRAIN (Branch A GO 조건부, 게이트 1/3)
- 삭제대상(정정 그레인): check_in_services 풋화장품 7/25 **3라인 = 73,000**, 부모 check_in fdd5c165(미접촉)
- 前 그레인(payments 30a9ac47 / 10,500) = RETRACT-AS-MOOT (별개 bare payment, 화장품 아님)

## freeze 셋 (rows=3 HARD)
| cis id | service_name | price | parent check_in | is_pkg | seller |
|--------|--------------|-------|-----------------|--------|--------|
| eeb760b3-…287e | 풋샴푸 (200ml) | 42,000 | fdd5c165 | false/null | 3a0c6774 (김규리) |
| 08162a7a-…f8ff | Care Toe Band (CTB) | 15,000 | fdd5c165 | false/null | 3a0c6774 (김규리) |
| a2dbbbfa-…383f | 리페어 핸드크림 (30ml) | 16,000 | fdd5c165 | false/null | 3a0c6774 (김규리) |
| **합계** | | **73,000** | | | |

부모 check_in fdd5c165: visit_type=experience, status=payment_waiting, deleted_at=null, **payments_on_checkin=0 (미결제)**.

## HARD 게이트 결과 (DA Q2)
- **#1 FK census = CLEAN(0)**: check_in_services 로의 선언 inbound FK **0건**. 데이터-값 링크(payment_items[check_in+svc]=0, service_charges[check_in+svc]=0)도 **0**. → cascade archive 불요, leaf 행.
- **#2 soft-void = 부재(0)**: check_in_services 에 deleted_at/is_voided/cancel/archiv/hidden 컬럼 **없음** → 물리 archive-first 경로 확정(flag 경로 해당 없음). ※부모 check_ins 는 deleted_at 보유하나 부모=미접촉 불변식.
- **#3 rows-affected=3**: dry-run SIM archived=3 / deleted=3 / remaining_after=0 (net-loss 0). freeze touched==3.

## Branch C 격상조건 (apply-time 재검증 대상, 현재 관측)
- (a) 3라인 payment/allocation 링크 = **0** (기대 0) ✓ 미발동
- (b) 8/1 twin cis 셋(5104417a/37e32d58/54d94955) = **3 실재**, 부모 check_in dec7e6c4 ✓
- (c) b7ab6496 = **73,000 / active / card / 8/1 / F-4741** 실재 ✓
→ Branch C 미발동. Branch A(line-only·미결제·중복확증) 성립. (7/25 유일 아님 = 8/1 twin 실결제 존재)

## No-Persistence 증명
- SIM: DO 블록 내 TEMP archive(LIKE) + DELETE + RAISE sentinel 강제 롤백.
- post-probe: 대상 cis 여전히 실재=3, 잔존 archive 테이블=0. → dry-run prod 무변경.

## DRY-RUN VERDICT: **PASS** (rows==3 · FK clean · soft-void 부재 · Branch C 미발동 · 무영속)

## 매출 정합 (DA Q3)
- 삭제대상 = payment 0개 라인 → redpay/recon 무접촉, A6 대시보드 매출 delta 0(7/25 미결제분 애초 미계상).
- SalesStaffTab: 김규리 화장품 double-count −73,000 정정. 8/1 결제 73,000 유지.

## prod apply = HOLD (3중 게이트)
DA GO(✅) + 총괄(김주연) 재confirm(pending) + supervisor MIG-GATE(dry-run 무영속·FK census·rows=3·freeze 재검증) 통과 전까지 미실행.
apply 러너는 --apply 플래그 없이는 no-op. §3.1 대표게이트(CEO) 불요(DA Q4).

## apply-time ABORT / Branch C 격상(→HARD NO-GO)
apply 직전 재검증에서 (a) 3라인 中 payment/allocation 링크 취득 or (b) 8/1 twin셋 부재/미결제 or (c) b7ab6496 부재 → 즉시 ABORT + planner FOLLOWUP(CEO 게이트 복귀). apply.mjs DO 블록에 하드코딩됨.

## 불변식 (0 touch)
payments(10,500 30a9ac47 / 5,200 / 73,000 b7ab6496) · check_ins(fdd5c165·dec7e6c4) · 7/25 비화장품 11라인 = 미접촉.
