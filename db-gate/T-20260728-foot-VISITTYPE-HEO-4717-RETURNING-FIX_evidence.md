# T-20260728-foot-VISITTYPE-HEO-4717-RETURNING-FIX — 진단 evidence (write 0, READ-ONLY)

> dev-foot / 2026-07-28 · 상태: **본작업 INSERT HOLD (전제 반증)** · planner FOLLOWUP 발행
> 재현 스크립트: `scripts/T-20260728-foot-VISITTYPE-HEO-4717_diag.mjs`, `_payment_probe.mjs`, `_pattern_scan.mjs`
> 프로젝트: obliv-foot-crm prod (rxlomoozakkjesdqjtvd) · clinic 74967aea(풋)

## 결론 (요약)
티켓 A안 전제("07-20 laser 수납 기록만 DB **누락** → payments INSERT 1건")가 **DB 실증으로 반증**됨.
07-20 현은호 결제는 **이미 존재**하며(orphaned), INSERT 시 **07-20 매출 8,800 이중계상**. → **본작업 INSERT 실행 안 함(HOLD)**.

## 근거 데이터

### A. 현은호(#F-4717) 결제 이미 존재 (orphan)
| payment_id | amount | method | check_in_id | accounting_date | external_trxid | external_status | reconciled_at |
|---|---|---|---|---|---|---|---|
| b695bea6-dff9-462b-9b47-fcb8bb9568f6 | **8800** | card | **NULL** | 2026-07-20 | 0720C7835749 | Y | 2026-07-20 06:34 |

- customer_id=6412fbf7(현은호), clinic=74967aea(풋), status=active, memo='영수증 수납(단건)', payment_type=payment.
- 즉 **"수납 기록 누락"이 아니라 "존재하나 check_in 미연결(orphan)"**.
- **매출 정합**: accounting_date=07-20 → 8,800은 **이미 07-20 매출에 계상됨**. INSERT하면 **이중계상**. 링크는 매출-neutral.

### B. service_charges 명세 = 0건 (고객 전체)
- check_in 6151b3b3 및 현은호 전체 service_charges **공집합**.
- → 티켓 자체 게이트("명세 없으면 착수 보류 + 현장 실결제금액 확인 or DA CONSULT") **발동**.

### C. 실제 RC = check_in status 정체 (INSERT/링크 무관)
- recency 판정(`src/lib/visitRecency.ts`)은 `check_ins.status='done'`(deleted_at NULL, clinic scope, <오늘KST자정)만 읽음.
- 현은호 done check_in **0건** → recency='new'(초진). 07-20 check_in `6151b3b3`은 `payment_waiting` 정체(done 미승격).
- **check_in_id=NULL은 정상상태** — orphan payments **203건**(07-14~07-28) 존재. 링크가 승격 기전이 아님. 승격 기전 = 스태프 '완료' 수동 액션.
- ∴ 초진 오분류를 푸는 조치 = **check_in 6151b3b3 status payment_waiting→done 단건 승격** (visit_type 강제 UPDATE 아님 — 티켓 §4 준수). 이후 recency 자동 재진.

### D. Item 2 — 반복패턴 확정 (systemic, 조회·보고만)
| 스캔 | 건수 |
|---|---|
| Q-A payment_waiting 정체 (<오늘, 풋) | **53건** (테스트계정 다수 + 실고객) |
| Q-B orphan payments (check_in_id NULL, active) | **203건** (07-14~07-28) |
| Q-C 현은호 패턴 정확일치 (orphan-pay ∩ same-day payment_waiting) | **12건 / 실고객 최소 8명** |

Q-C 실고객: 엘런(50만×3), 양재경(26만·5.6천), 정성호(25만·5.6천), **현은호(8.8천)**, 장선영(35만), 박경수(30만), 강성민(25만), 조재훈(26만).
→ '진료동선 완주 + 실결제 존재하나 payment_waiting 정체 → 초진 오분류 위험'은 **단발 아님**. 별도 P1 후속 제안.

## 권고 (planner 재정의 요청)
1. 본작업: payments INSERT → **check_in 6151b3b3 status→done 단건 승격**으로 재정의 승인(또는 DA CONSULT). 승인 전 write 0.
2. Item 2: 53 stuck / 8+ 실고객 → 별도 P1(payment_waiting 정체 일괄 진단·정산 게이트) 신설.
3. Item 3(강경민 배정이력 정합): 본작업 적용 후 검증 — 현재 보류.

---

## ✅ APPLIED — status→done 단건 승격 (2026-07-28 11:48 KST / 02:48Z)
> DA CONSULT-REPLY GO_WARN(MSG-8fb8) 승인 후 실행. payments INSERT 폐기 → status 단건 승격.
> 적용 스크립트: `scripts/T-20260728-foot-VISITTYPE-HEO-4717_promote_apply.mjs` (단일 DO 블록, 각 문 GET DIAGNOSTICS rows=1 강제·RAISE시 전체 롤백)
> 롤백: `scripts/T-20260728-foot-VISITTYPE-HEO-4717_promote_rollback.sql`
> 컨텍스트: Management API /database/query (postgres 권한 = service_role equiv, RLS bypass)

### 트리거 사전검증 (step2 완료일 교정 안전성 근거)
- `set_completed_at()`: `completed_at:=NOW()`는 **OLD.status IS DISTINCT FROM 'done'** 일 때만. step1(→done)에서만 발화, step2(done→done)는 양 분기 미발화 → 07-20 교정값 **보존 확정**.
- `fn_checkin_cancel_restore_reservation()`: →cancelled 에서만 발화. →done no-op.
- `sync_waiting_board()`: →done 시 waiting_board DELETE(큐 제거, 정상)·예외격리.
- dopamine callback trigger = AFTER **INSERT** 전용 → UPDATE 승격은 outbox emit 0 (DA Q4 정합).

### 적용 결과 (POSTCHECK)
| step | 문 | rows-affected |
|---|---|---|
| pre | freeze SELECT: check_in 6151b3b3 status='payment_waiting' 확인 | 1 |
| step1 | UPDATE status payment_waiting→done | **1** |
| step2 | UPDATE completed_at:=2026-07-20 06:32:00+00 (권위=payment b695bea6.created_at) | **1** |
| step3 | INSERT status_transitions (changed_by='system:backfill:T-20260728-foot-VISITTYPE-HEO-4717', transitioned_at=07-20) | **1** |
| step4 | SKIP (status_flag 이미 'dark_gray' = no-op, DA 선택항목) | — |

### 최종 상태
- check_in `6151b3b3`: status=`done` / completed_at=`2026-07-20 06:32:00+00` / status_flag=`dark_gray` / **visit_type=`new` 불변**(강제 UPDATE 금지 §준수).
- status_transitions 1행 존재(감사지문 changed_by).
- **매출 중립 확인**: payments INSERT 0. 07-20 accounting slice = n:1 / total:8,800 (b695bea6 그대로, 이중계상 없음). orphan payment check_in_id=**NULL 유지**(링크 금지 §준수, DA Q2).
- **recency 재분류 검증**: `resolveVisitTypeByRecency` 동형 쿼리 → latest done <today KST = 2026-07-20 → diff=8d ≤ 365 → **returning**. 강경민 배정이력 현은호 초진→재진 이동 확정.

### AC 충족
- AC1 원인기록 ✅ / AC2(개정) status→done→recency 자동 returning ✅ / AC3 배정이력 정합(recency=returning) ✅ / AC4(개정) payment INSERT 없음·07-20 매출 이중계상 없음·타행 무접점 ✅ / AC5 반복패턴 53/12/8명 조회완료→별건 P1(PAYMENT-WAITING-STUCK-PROMOTION-CLASS) ✅.
