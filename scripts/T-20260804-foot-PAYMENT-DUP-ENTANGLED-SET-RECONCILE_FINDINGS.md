# T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE — dev-foot FINDINGS

- 고객: 남정현 (9487b2f7-0769-4038-a373-84182f6acc11 / F-5263) @ 풋센터 74967aea
- SSOT: `memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_payment_dup_entangled_set_reconcile_20260804.md`
- CONSULT-REPLY: MSG-20260804-174812-5shd (data-architect → dev-foot). verdict = 표면 "2행 삭제" REJECT → 얽힌집합 정합 GO(조건부).
- freeze baseline: `memory/_handoff/evidence/T-20260804-foot-PAYMENT-DUP-DELETE-NAMJH_phaseA_snapshot.json` (DO-NOT-MUTATE)
- change-class: DESTRUCTIVE-but-reversible money-ledger data-correction (payments soft-delete + package_payments archive-first)
- da_consult_ref: da_decision_foot_payment_dup_entangled_set_reconcile_20260804.md (GO 조건부)
- ★ status: **BLOCKED-ON-GATES** — dev-foot 는 apply 하지 않음. 게이트(박민지 per-row + supervisor dry-run) 선행.

---

## 1. dev-foot 4대 선결(DA §9 ball) — 전건 완료

### (1) 얽힌집합 membership 확정 — 6행 + 캐시 (NOT 2행). 명시 PK VALUES.
payments (status 有 → **soft-delete**):
| id | ptype | amount | 성격 | tier |
|---|---|---|---|---|
| 46821230-d76e-49ab-b5c3-a9e69a5a5255 | payment | +8,800 | 7/30 단건 8,800 중복 (target#1) | A 확정 |
| e0dc5d36-6530-44ec-b848-10b1b590b2d2 | refund | −8,800 | target#1 undo (linked_payment_id=target#1) | A 확정(동반) |
| fa509f09-48bb-4859-a470-589e15df1868 | payment | +1,400,000 | 팬텀 단건 (pkg=NULL, 패키지 잔금을 단건 오입력) | A 확정 |
| 73e604cf-9b78-4f86-b5c9-a09f204cf086 | payment | +8,800 | 추가 단건 (중복 의심) | **B PENDING-CONFIRM(기본 HOLD)** |

package_payments (status 부재 → **archive-first DELETE**):
| id | ptype | amount | 성격 |
|---|---|---|---|
| 38b5c660-787a-4beb-9da6-a2bc32f12f65 | payment | +1,400,000 | 완납 패키지 중복 재입력 (target#2) |
| 5182ecea-d124-419b-94e9-742e04d9b944 | refund | −1,400,000 | target#2 undo (net-neutral 쌍) |

캐시: `packages.paid_amount` = 3,800,000 (stale) → recompute **2,400,000**.
★ 라이브 실측(dry-run): package_payments 원장 net 은 **이미 2,400,000**(target#2 +1.4M ↔ 5182ecea −1.4M 자기상쇄). 손상은 **paid_amount 캐시(3.8M)에만** 존재 → recompute 로 정정.

### (2) fa509f09 팬텀 / 73e604cf 중복 → per-row confirm 항목(박민지)
- fa509f09 = pkg=NULL·external_trxid=NULL·1.4M 단건 = 패키지 잔금 단건 오입력(팬텀) 강한 정황. 단 실기록 배제 위해 박민지 confirm 대상.
- 73e604cf = 중복 의심. **under-correct ≫ over → 기본 HOLD**(apply 스크립트 `v_include_73e604cf := FALSE`). 박민지 중복 confirm 시에만 TRUE.
  - HOLD → single net **17,600** / REMOVE → single net **8,800** (둘 다 DA §5 유효 oracle).

### (3) ★ basis-parity 축 확정 (DA §7 선결) — **closing/outbox = created_at KST**
- **stats RPC**(`foot_stats_revenue`) = `accounting_date` (T-20260715-REVENUE-ATTRIB-AXIS-UNIFY). ← 이 정정과 무관한 별축.
- **closing/outbox** = `created_at` KST. 근거: 오늘(2026-08-04) T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE 의 READ-ONLY HARD census —
  `daily_closings.package_*/single_*`(Q1 권위) = FE Closing.tsx 가 `(created_at AT TIME ZONE 'Asia/Seoul')::date` 윈도우로 집계.
  accounting_date 윈도우는 소급정정 11행에서 daily_closings 와 발산(08-01 sys 11,353,900 vs acct 12,772,700) → created_at KST 만 11/11 ±0 일치.
  구 pilot 의 `COALESCE(revenue_date,refund_date,checked_in_at,created_at)` 윈도우도 오늘 created_at KST 로 정렬됨.
- **∴ restatement 착지일**: freeze 행 created_at KST 기준 —
  - **7/31 (KST)**: target#1(+8,800) + target#2(+1.4M pkg) = **1,408,800 → 0** (전량 오류 제거). ← DA §7 primary branch 확증.
  - **8/1 (KST)**: e0dc5d36(−8,800)+fa509f09(+1.4M)+73e604cf(+8,800)+5182ecea(−1.4M) = **net 0 → 0** (구성만 변경).
- **DA §7 재-CONSULT 트리거 (c)[closing=accounting_date라 8/1 already emitted] = 불발동**(closing=created_at KST 확정).

### (4) outbox recompute 거동 확인
- payload total = **emit-time recompute**(`v_total`, HERALD-PAYLOAD-RECONCILE C6) — actual_* 는 트리거-시점 스냅샷(audit·권위 아님).
- soft-delete 행은 closing 윈도우 `.neq('status','deleted')` parity 로 **자동 제외** → payments soft-delete = closing 에서 자동 빠짐.
- 재확정(`closing_confirmed_edit` RPC, 20260802160001) → revision+1 → outbox 재enqueue **이미 배선**(C7).
- ∴ **correct-then-emit**: 데이터 정합 완료 후 7/31(+8/1) 마감 재확정 시 payload 자동 정정 emit.
- ⚠ dry-run 실측: closing_confirmed_outbox 7/30·7/31·8/1 = 전건 rev0·superseded=false·dlq=false·**total_krw="0"** (7/30 행 created 7/29 = pre-date → shadow-pilot 정황). 실 확정/소비 여부는 dev-sales(reader-side) 소관 → correct-then-emit follow-through 시 DA/dev-sales 확인 대상. **본 데이터 정합 blocking 아님**(행 제거는 축-무관).

## 2. 산출물
- `scripts/…_apply.sql` — 트랜잭션 apply(freeze re-verify drift ABORT → archive-first → soft-delete → pkg archive+DELETE → 캐시 recompute → 구성적 oracle assertion RAISE→rollback). **73 토글 기본 FALSE(HOLD)**.
- `scripts/…_dryrun.mjs` — READ-ONLY drift 재검 + 현재/투영 oracle + outbox status. (F4857 forensic idiom 계승)
- `evidence/…_dryrun.json` — 2026-08-04 실행 결과: **NO-DRIFT (freeze 유효)** / 투영 oracle 전건 PASS.

## 3. 잔여 게이트 (dev-foot 소관 아님 — 라우팅 완료)
1. **박민지 per-row comp-gate** (planner/responder 경유): 각 행 disposition + 구성적 end-state(pkg 2.4M/bal 0 + single 8,800|17,600) + fa509f09 팬텀 / 73e604cf 중복 confirm.
2. **supervisor dry-run + apply**: rows-affected==freeze count exact / archive read-back 순소실0 / apply-직전 재-freeze drift ABORT. apply 는 supervisor 실행.
3. **원장/대표 magnitude awareness** (7/31 −1,408,800 restatement material, non-blocking 통지·§6-4).

## 4. systemic follow-up (별건·비블로킹, DA §8) — 티켓화 후보
1. `packages.paid_amount` 일반 recalc 트리거 부재(Plan-B card RPC 만 세팅) → package_payments write 시 recalc 트리거. **dev-foot lane.**
2. `package_payments` status/void 컬럼 부재(payments 대비 비대칭) → 반복 정정 시 ADDITIVE void 컬럼 후보.
3. 진원: 중복입력 허용 UI/UX(7/30 패키지 3회 입력·2회 환불 churn) → forward-fix 후보(dev-foot/planner).
