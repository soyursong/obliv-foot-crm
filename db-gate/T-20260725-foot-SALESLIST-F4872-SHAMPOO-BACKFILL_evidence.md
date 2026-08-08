# T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — F-4872 evidence (db_only)

단건 backfill: **F-4872 김정숙 풋샴푸(200ml) 42,000 카드 / 판매자 임별 / 판매일 2026-07-18**
saga 잔여 마지막 leg. nph2 confirm 도달(MSG-20260809-072208-ndc6, 김주연 총괄 U0ATDB587PV "실결제 맞음·카드·7/18·임별").

## 분기 확정 = rwrj 행별 3분기 → 분기① atomic INSERT (prod 실측 근거)

census: `scripts/T-20260725-foot-SALESLIST-F4872-census.mjs` (service_role read-only, write 0)

| 축 | 실측 | 판정 |
|----|------|------|
| customer F-4872 | 김정숙 `f98676b2-2bbe-4050-ac5b-803c41e28e55` (clinic 74967aea 서울오리진점) | resolve OK |
| 임별 staff | `7c24cd3b-8e52-4c72-9652-e14f75151514` role=therapist active=true **단일 row** | 중복 active 없음 = 김규리 같은 모호성 0, resolve clean |
| 풋샴푸(200ml) service | `89095450-223f-4863-89a9-c7f32f62809d` price=42000 category=풋화장품 active | 단일 매칭 |
| check_in_services 라인 | **0건** (price=42000 라인 0) | 풋샴푸 라인 부재 |
| 매칭 payment | **0건** (amount=42000 payment 0; 기존 1,820·1,800·1,800 = 무관 별거래) | 수납 부재 |
| **분기** | 라인 0 + payment 0 | **① atomic INSERT (payments + line)** |

**앵커 check_in = `f6ca21d1-a672-4cd4-b407-588e5940c327`** (2026-07-18, therapist=7c24cd3b **임별** = seller 본인, status=payment_waiting)
- field 판매일 07-18 = 앵커 방문일(임별 대면)과 **일치** → `accounting_date=2026-07-18` 채택.
- F-4550 같은 divergence **없음**(07-18 방문 자체가 임별 seller 방문) → **shift/disclosure 불요**.
- 42,000 매칭 카드거래 흔적 부재 + status=payment_waiting = payment 캡처 누락 = 분기① 근거.

## 실행 파라미터

- seller_staff_id = `7c24cd3b` (임별, therapist) — 단일 active row.
- service_charge_id = **NULL** (풋샴푸=비급여, 급여 브릿지 불요; payments 측 컬럼, check_in_services 엔 컬럼 없음).
- 고정 PK: line `87beac3a-df9b-433b-827e-43e51a1d2107` / payment `7b8b9f74-c7aa-4d23-92ad-42033ec02096`.

## 급여split netting (line-only 오염 회피)

payment·line 동일 check_in(f6ca21d1) 페어링, seller=therapist=임별 자기정합:
- payment(+42,000 → ci therapist 임별) − 화장품차감(−42,000 → 동일 ci therapist 임별) = **치료매출 순증 0**
- 화장품 컬럼 seller=임별 **+42,000**, systemTotal(payments-grain) **+42,000**. 급여split 오염 0.
- §268 line-only 능동차감/zero-out 회피 = payment 동반으로 상쇄 정합.

## 교차참조 — double-authoring 방지 (§13.1.C)

`T-20260804-foot-COSMETIC-CORRECTION-CRM` #3도 동일 F-4872 42,000 참조(그 티켓은 F-4872 제외 deployed).
본 SALESLIST rwrj payments 프레임워크가 **실행 authoritative** — 멱등 HARD(WHERE NOT EXISTS + 고정 PK ON CONFLICT DO NOTHING)로 단일 INSERT 보장, 이중 authoring 차단.
COSMETIC-CORRECTION Tier1 기대값(임별 화장품 총 99,000에 본 42,000 포함) = POSTCHECK reconcile 검산 근거.

## 멱등 HARD

- 라인: `WHERE NOT EXISTS (check_in+service+price=42000)` + `ON CONFLICT (id) DO NOTHING`
- payment: `WHERE NOT EXISTS (check_in+amount=42000+payment_type+status<>deleted)` + `ON CONFLICT (id) DO NOTHING`
- dry-run apply×2 → 2회차 0-row 확증(무예외 반환).

## mig_dryrun (No-Persistence Protocol via mgmtapi) — PASS

스크립트: `scripts/T-20260725-foot-SALESLIST-F4872_dryrun_mgmtapi.mjs`
- (L) ledger: version 20260809080000 fresh(미존재) + max 20260807180000 < 본 version(정순, backdating 0) ✓
- (0) baseline: new_lines=0 / new_pays=0 (중복 apply 흔적 0) ✓
- (1) canary: BEGIN;COMMENT;ROLLBACK → 무영속 선증명(canary after=null) ✓
- (2) apply×2 + verify(BEGIN…ROLLBACK): 무예외 = 구문/rows-affected/멱등/shape(amount·method·accounting_date·service_charge NULL·seller·anchor) 통과 ✓
- (3) post-probe: prod 미변경(new_lines=0/new_pays=0) ✓
- 예상 rows-affected(실 apply) = line INSERT 1 + payment INSERT 1 = **2 writes**.

## mig_rollback

`supabase/migrations/20260809080000_foot_saleslist_f4872_shampoo_backfill.rollback.sql`
= 고정 PK DELETE 2행(payment + line). seller UPDATE 없음(분기① 신규 INSERT만). 재실행 0-row 안전.

## ★apply 순서 (db_change=true)

Gate-B(DA rwrj) GO ≠ apply 허가. **supervisor DB-GATE GO-token 발행 후에만 prod apply.**
apply 스크립트: `scripts/T-20260725-foot-SALESLIST-F4872_apply_mgmtapi.mjs` (GATE_TOKEN chokepoint — 미제공 시 abort).
GO-token 前 prod payments 잠금원장 INSERT 선집행 금지(apply_before_go 클래스). 실tender attest(field confirm 카드)·이중수납 위조 abort 준수.

## POSTCHECK (apply 후 잔여)

1. 삽입 SELECT 재확인 (apply 스크립트 내장): new_lines=1 / new_pays=1 hard assert.
2. SalesStaffTab(담당치료사별 화장품 매출집계) 임별 칸에 F-4872 42,000 반영 브라우저 육안 확인.
3. e2e_spec_exempt_reason: db_only (UI 코드 변경 0).
