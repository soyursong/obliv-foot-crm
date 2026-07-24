# (B) 서류테스트2 — pure-test census + CLEAR-B 노출창 + flip 후보 (READ-ONLY, WRITE 0)

- ticket: T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL
- in-reply-to: planner NEW-TASK MSG-20260724-223114-zsah (P0)
- DA disposition: reporting-exclude (is_simulation=TRUE flip, 원장 in-place 보존) — hard-DELETE ABORT 확정
- 실행: `node scripts/...TESTDATA-DEL_B_census_puretest_clearB.mjs` · READ-ONLY · canary ROLLBACK 무영속 선증명 ✅ · prod 무변경
- date: 2026-07-24 (census 시각 ~22:46 KST)

---

## 대상

| 항목 | 값 |
|---|---|
| customer_id | **80df7a6b-077d-46db-b9db-31591f3977a4** (name=`서류테스트2`, phone=합성 test 번호 마스킹) |
| clinic | jongno-foot = 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브의원 서울오리진점) |
| customers.is_simulation 현재값 | **FALSE** (created 2026-07-24 05:35:29, updated 05:48:14) |
| 서류테스트2 case check_in | 7f3f8b79-eb3d-45f2-afab-205d52bc4a70 (status=done, visit_type=new) |

---

## ① Q2b pure-test 판정 = **YES (pure-test 확정)** → 1순위 경로(단건 flip)

이 고객의 foot DB 전 활동이 **단일 서류테스트2 case 에만 귀속**된다. case 외 실 활동 0.

| 테이블 | 건수 | 서류테스트2 case 외 실활동 | 근거 |
|---|---|---|---|
| check_ins | 1 | **0** | 유일 check_in = 7f3f8b79 (서류테스트2 case 본체) |
| reservations | 1 | **0** | 668e198c = check_ins.reservation_id 로 7f3f8b79 에 bind = 같은 case 접수 예약 (created 05:35:30, 고객생성 +1초, source_system NULL, created_via manual) |
| payments | 4 | **0** | 전건 check_in_id=7f3f8b79 (각 8,800 net-test, accounting_date 2026-07-24) |
| service_charges | 2 | **0** | 전건 check_in_id=7f3f8b79 (base 18,840+10,535=29,375) |
| packages | 1 | **0** | 01ddef31 (paid 0, memo=`테스트용 환불예정`, 1회차 orphan) |
| appointments/consultations | 0 | 0 | — |

- 고객·예약·방문·결제·명세·패키지가 **2026-07-24 05:35~10:24 단일 시퀀스** 안에서만 생성됨. 타 날짜·타 case·실 방문 이력 전무.
- 이름=`서류테스트2`, 패키지 memo=`테스트용 환불예정` = 명백 test 데이터.
- ★ `is_simulation` 컬럼은 **전 public 스키마에서 `customers` 에만 존재** (payments/service_charges/telemetry 전부 부재) — 확증. 유니버스 필터가 customers.is_simulation 을 키잉(DA closing_payload §1-4).

**⇒ pure-test 이므로 `customers.is_simulation=TRUE` 단건 flip 만으로 payments·service_charges·telemetry 전부 기존 유니버스 필터(is_simulation IS NOT TRUE)에 의해 자동 제외. DDL 0 · FK 무접점 · 순소실 0. 폴백(payments/sc ADDITIVE 컬럼) 불요.**

> (자동 러너의 `잠정 pure-test=NO` 플래그는 reservations.length===0 조건이 과엄격했던 것 — 그 1건은 case 내부 접수예약으로 실활동 아님. 수동 검증 결과 pure-test=YES.)

---

## ② CLEAR-B 노출창 = **마감확정 payload 미발사 → prevention**

| 신호 | 값 | 판정 |
|---|---|---|
| **closing_confirmed_outbox** (jongno-foot, 2026-07-24) | id 9515612c, status=**pending**, sent_at=**null**, attempts=0, dlq=false, superseded=false, event_id 8432e39d | **미발사** |
| daily_closings (jongno-foot, 2026-07-24) | status=`closed`, closed_at=2026-07-24 11:25:43Z(=20:25 KST), confirmed_by=**null**, revision 0, dirty=false | 로컬 일마감만 closed (payload 확정발사 아님) |
| daily_closings status enum | {open, closed} — `confirmed` 상태 없음. confirmed_by NULL | — |
| jongno-foot outbox 최근 1주(07-18~07-24) | **전건 pending / sent_at null** | 상시 미발사(consumer 부재) |
| dev-sales fct 대사 lane (gate_status 22:39) | PREVENTION 확정 (foot→데이터레이크 ETL 0, jongno-foot=SILVER_NO_DATA) | 데이터레이크 무접점 |

- 마감확정 payload(outbox) = **pending·sent_at null·attempts 0 = 미발사**. → 노출창 정의(마감 confirm 트리거/outbox 발사)상 **prevention**.
- 참고: 로컬 daily_closings 는 20:25 KST 이미 `status=closed`(일마감 자체는 완료, confirmed_by NULL). 단 (a)payload 미발사 + (b)로컬 close 스냅샷(payments_snapshot_hash)은 flip 으로 소급 변동 안 함 + (c)fct/데이터레이크 무접점 → **downstream 노출 0**.
- ∴ **flip 외 조치 0 (prevention).** payload·fct 재대사 불요 (dev-sales PREVENTION 과 정합).

> time-sensitive 단서: DA 권고 "마감 前 선제 flip" 의 로컬 일마감 시점(20:25 KST)은 이미 경과했으나, payload 미발사 + snapshot 소급무변 + 데이터레이크 단절로 **노출 위험은 어느 시점에도 0**. flip 은 DA 권고대로 게이트 통과 즉시 진행 권장(지연 위험은 낮음).

---

## ③ flip 후보 SQL (★실행 금지 · WRITE HOLD · supervisor DB-GATE + 형 apply_gate 후)

```sql
-- ▶ FORWARD (reporting-exclude flip)
UPDATE public.customers SET is_simulation = TRUE, updated_at = now()
WHERE id = ANY(ARRAY['80df7a6b-077d-46db-b9db-31591f3977a4']::uuid[])
  AND is_simulation IS DISTINCT FROM TRUE;
-- expected rows-affected = 1

-- ▶ ROLLBACK (원복)
UPDATE public.customers SET is_simulation = FALSE, updated_at = now()
WHERE id = ANY(ARRAY['80df7a6b-077d-46db-b9db-31591f3977a4']::uuid[]);
-- expected rows-affected = 1
```

- flip dry-run(BEGIN;UPDATE…RETURNING count;ROLLBACK) **rows-would-affect = 1** · 롤백 후 is_simulation=FALSE 무영속 재확인 ✅.
- FK 무접점(customers 단건, 자식 CASCADE/SET NULL 무발생) · DDL 0 · 순소실 0.

---

## 종합 처분 권고 (dev-foot)

1. **경로 = 1순위 단건 flip** (pure-test YES 확정). 폴백(ADDITIVE) 불요.
2. **분기 = prevention** (payload 미발사 + 데이터레이크 단절). payload/fct 재대사 불요.
3. **flip WRITE = HOLD** — supervisor DB-GATE + 형 apply_gate 후 적용. 후보 SQL·롤백·rows-affected(1) 준비 완료.
4. hard-DELETE 는 폐기(ABORT) — form_submissions 10 printed 의무기록 보존 + payment_reconciliation_log 324 등 파괴열거 모두 flip 으로 대체.
