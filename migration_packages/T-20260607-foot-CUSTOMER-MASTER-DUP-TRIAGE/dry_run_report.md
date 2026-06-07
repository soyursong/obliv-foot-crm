# T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE — AC1 트리아지 + AC2 병합 제안서

- 대상 DB: foot prod `rxlomoozakkjesdqjtvd` · clinic `74967aea`(종로 풋) · table `public.customers` (+27 ref FK)
- AC1 산출: `scripts/T-...-DUP-TRIAGE_ac1.mjs` (READ-ONLY) → `scripts/out/...ac1.{md,json}` (out/ gitignore → 본 사본 동봉)
- **READ-ONLY 트리아지 완료(무변경). 병합 SQL = `merge_proposal.sql`(DO NOT EXECUTE, 게이트 대기).**

## 게이트 순서 (불변)
1. **AC1** dry-run 트리아지 (READ-ONLY) — ✅ 완료
2. **AC2** 병합 제안서 (`merge_proposal.sql` + `rollback.sql` + 본 문서) — ✅ 작성 (실행 아님)
3. **AC3** 문지은 대표원장 케이스별 GO/보류 확인 (planner→responder 경유) — ⏳ 대기
4. **AC4** supervisor 단독 DB 게이트 GO — ⏳ 대기
5. **AC5** 실행·검증 (확인된 케이스만) — ⏳ 대기

> AC3·AC4 GO 전까지 customers/FK 의 어떤 UPDATE·DELETE·병합도 금지. dev-foot 자동 실행 금지.

## 참조 FK 맵 (customers.id 참조 27 컬럼)
check_ins · checklists · clinical_images · consent_forms · customer_special_notes · customer_treatment_memos ·
customers.referrer_id · form_submissions · health_q_results · health_q_tokens · insurance_documents ·
insurance_receipts · message_logs · notification_logs · notification_opt_outs · package_payments · packages ·
packages.transferred_to · patient_room_daily_log.patient_id · payment_code_claims · payments · prescriptions ·
reservation_memo_history · reservations · service_charges · customers.unified_customer_id · customers.designated_therapist_id

**자식 UNIQUE(customer_id 포함) 제약: 없음** → 재귀속 충돌 없음(병합 안전성 핵심 근거).

---

## ① 김규리 — dup_pair · **clear GO 후보**
| 항목 | KEEP(정본) | ERR(중복) |
|---|---|---|
| id | `7fa5dff1-85c0-4f60-88a1-103fca36fdd5` | `7cef3be8-211f-4685-8c80-5141240328cf` |
| phone | +821023682507 ✅실 | +821012345679 🧪test |
| chart | F-0800 | F-0994 |
| visit_type | returning | new |
| created | 2026-05-30 14:23 KST | 2026-06-02 19:46 KST |
| 연결자산 합 | 19 | 4 |
| 판정점수 | 24 | 4 |

판정: 중복측 phone 이 test(1234-5679) → **정본=KEEP 7fa5dff1 (티켓 지정과 일치 ✅)**.
ERR 재귀속 대상: `check_ins`×1(c0084c15:payment_waiting) · `health_q_results`×1 · `health_q_tokens`×2.
충돌: 없음(phone/chart 동일 아님, ERR DELETE → 신규 unique 충돌 없음).

## ② 김민경 — MISLINK (신원 혼입) · **HOLD · 자동금지 · 최우선 보고**
- check_in `10f10231` name=**김민경** phone=+821099999999(test 9999) status=consult_waiting visit=new (06-06)
- 현 customer_id=`3da2d8ef`(김구번, **test 고객**) — name 불일치 = **신원 혼입**
- 진짜 김민경=`83ab4fe1` phone=+821043160981(F-0177) → **check_in phone(9999) ≠ 진짜 phone(4316-0981) → 동일인 확증 불가**
- 김구번(test 3da2d8ef) 보유 자산: `check_ins`×2(10f10231, 536706fa:healer_waiting) · `health_q_tokens`×1
- **옵션 A/B/C 어느 것도 자동 진행 불가 → 대표원장(문지은) 신원 확인 필수.** `merge_proposal.sql` 에 실행 SQL 없음(주석 골격만).

## ③ 김승현 — dup_pair · **clear GO 후보**
| 항목 | KEEP(정본) | ERR(중복) |
|---|---|---|
| id | `fcdcd44f-51f0-4dd0-87f9-9e6b2fd90f5b` | `53661ce0-5d3a-4da6-8459-121c36860d45` |
| phone | +821028490209 ✅실 | +821111111111 🧪test |
| chart | F-0360 | F-0897 |
| visit_type | returning | returning |
| created | 2026-05-22 16:20 KST | 2026-06-02 02:25 KST |
| 연결자산 합 | 1 | 2 |

판정: 중복측 phone 이 test(1111-1111) → **정본=KEEP fcdcd44f (티켓 지정과 일치 ✅)**.
ERR 재귀속 대상: `check_ins`×1(2b774003:done) · `health_q_tokens`×1. 충돌: 없음.

---

## AC2 병합 설계 (dup_pair 공통)
1. **STEP 0 백업**: ERR customers 2행 → `_merge_bk_T20260607_cmaster_customers`; 이동 자식행 → `_merge_bk_T20260607_cmaster_moves`(테이블·행id·원/신 customer_id).
2. **STEP 1 재귀속+DELETE** (단일 트랜잭션): `information_schema` 로 27 FK 컬럼 + self-ref(unified/designated) **실행시점 전수 열거** → 드라이런 이후 신규행까지 빠짐없이 ERR→KEEP 이동 후 ERR customers DELETE. 트랜잭션 내 잔존 검증(실패 시 ROLLBACK).
3. **역연산**: `rollback.sql` — ERR 부모 재INSERT → 이동대장 기준 자식행 KEEP→ERR 원복(현값이 KEEP일 때만).

### supervisor 게이트 체크포인트
- [ ] 대표원장 김규리·김승현 병합 방향 GO 확인됨
- [ ] 김민경 = 별건 HOLD(병합 SQL 미포함) 인지 확인됨
- [ ] STEP 0 백업 2테이블 생성·행수 확인(customers 2행) 후에만 STEP 1 진행
- [ ] 실행 후: 동명 실명 중복 0(김규리=1·김승현=1) + ERR 재귀속 자산 무손실 + 부모 check_in 정합
