---
ticket_id: T-20260531-data-JONGNOFOOT-MIGRATE-HFQ-TO-FOOT
stage: AC-7 package (READ-ONLY design)
mutation: NONE — SELECT only (HFQ ose_query + foot prod PostgREST). 0 INSERT/UPDATE/DELETE.
route_to: supervisor (단독 게이트)
gate: AC-7 패키지 → supervisor GO → 대표 confirm → INSERT
author: agent-fdd-dev-foot
date: 2026-05-31
---

# AC-7 dedup 재설계 + 이관 패키지 (실수치 한정)

> CORRECTION HOLD 해제 후, AC-8 합의(testdata 80 = 더미↔더미, 이관 제외)를 반영한
> **실데이터 한정** 이관 설계. INSERT 미실행 — 게이트 통과 전까지 설계 산출만.

## 0. 소스/타깃

| | DB | clinic_id | slug |
|---|---|---|---|
| SOURCE | HFQ `muvcfrgmxlwtidundlre` | `e49b687f-1533-43e9-9814-f5d9d64ba97f` | jongno-foot |
| TARGET | foot prod `rxlomoozakkjesdqjtvd` | `74967aea-a60b-4da3-a0e7-9c997a930bc8` | jongno-foot (서울 오리진점) |

## 1. dedup 재설계 (3단)

소스 HFQ jongno-foot customers 94건 → **3단 필터**로 이관 후보를 좁힌다.

1. **더미대역 제외** — `phone ∈ +821000002901~+821000002980` 또는 `memo LIKE '%[testdata_20260529_hfq]%'` → **80건 제외** (AC-8 합의: 더미↔더미).
2. **소스 내 중복 제거** — 정규화 전화(E.164→local 010) 기준 동일전화 collapse. (`까치`/`까치2` 둘 다 `01099991111` → 1건) → **−1건**.
3. **prod 중복 제거** — 정규화 전화가 이미 foot prod jongno-foot customers(520건, 516 distinct)에 존재하면 skip → **−5건** (기존 고객).

```
94 − 80(더미) = 14 untagged
14 − 1(소스중복) − 5(prod기존) = 8 신규 INSERT
```

정규화 규칙: `+82XXXXXXXXXX → 0XXXXXXXXXX`, 비숫자 제거. migrate.sql STEP1/STEP2 dedup guard에 동일 로직 인라인.

## 2. 실수치 이관 scope (확정)

| 대상 | 소스(real) | 이관(INSERT) | 비고 |
|---|---|---|---|
| customers | 14 untagged | **8** | 소스중복 1 + prod기존 5 제외 |
| check_ins | 15 real | **13** | orphan 2 제외 (아래 §4) |
| reservations | 80 | **0** | 전부 더미시드 — 이관 없음 |

→ MQ 지시 ②(신규 customers ~8 + check_ins 13, reservations 0)와 **정확히 일치**.

## 3. INSERT 대상 상세 — customers 8

| # | 이름 | phone(E.164) | 비고 |
|---|---|---|---|
| 1 | 김와사비 | +821056688566 | |
| 2 | 김와사비 | +821099786634 | 동명 다른 전화 (3건 중 1) |
| 3 | 김와사비 | +821066442622 | 동명 다른 전화 (3건 중 2) |
| 4 | **까치** | **+821099991111** | ⚠️ **TEST-PATTERN ...99991111 — 육안 확인 포인트 A** |
| 5 | 로오즈 | +821054757585 | |
| 6 | 로오즈 | +821065566658 | 동명 다른 전화 |
| 7 | 오구리 | +821066845621 | |
| 8 | 춘향이 | +821055459722 | |

제외된 6건: `까치2`(소스중복 01099991111) + prod 기존 5건(`김민경` 01043160981 / `머루` +821099060089 / `잣` +821099060083 / `까치` 01099990003 / `빨강` 010-9999-0201).

## 4. INSERT 대상 상세 — check_ins 13 + orphan 2(제외)

13건 모두 `status='waiting'`(HFQ). foot 타깃 매핑 후 customer_id는 정규화 전화로 resolve (신규 8 + 기존 5 = 13 phone 전부 1:1 매칭).

| 날짜 | 이름 | phone | customer 매핑 | flag |
|---|---|---|---|---|
| 05-29 | 김와사비 | +821056688566 | 신규 | |
| 05-30 | 김와사비 | +821099786634 | 신규 | |
| 05-30 | 김민경 | +821043160981 | **기존 prod** | |
| 05-30 | 로오즈 | +821054757585 | 신규 | |
| 05-30 | 로오즈 | +821065566658 | 신규 | |
| 05-30 | 오구리 | +821066845621 | 신규 | ⚠️ DUP-SUSPECT (2건) |
| 05-30 | 오구리 | +821066845621 | 신규 | ⚠️ DUP-SUSPECT (2건) |
| 05-30 | 춘향이 | +821055459722 | 신규 | |
| 05-30 | 김와사비 | +821066442622 | 신규 | |
| 05-30 | 머루 | +821099060089 | **기존 prod** | |
| 05-30 | 잣 | +821099060083 | **기존 prod** | |
| 05-31 | **빨강** | **+821099990201** | **기존 prod** | ⚠️ **TEST-PATTERN ...99990201 + DUP (2건) — 육안 확인 포인트 B** |
| 05-31 | **빨강** | **+821099990201** | **기존 prod** | ⚠️ 동상 |

**orphan 2건 — 이관 제외**:
- `바나나 +821000002944` (2026-05-29) → 고객이 **더미대역(2944)** = 이관 안 된 더미 → FK 미해결 → 제외.
- `까치 +821099990001` (2026-05-29) → `customer_id = NULL` (고객 미연결) → 제외. (또한 ...99990001 테스트성)

## 5. 사람 육안 확인 포인트 (INSERT 전 — MQ 지시 ④)

> test-pattern phone 행은 prod 적합성을 사람이 직접 판단해야 함. **GO 전 반드시 확인.**

- **확인 A — customers `까치` +821099991111** (TEST-PATTERN ...99991111): 실고객인가, 셀프접수 테스트 입력인가?
- **확인 B — check_ins `빨강` +821099990201 ×2** (TEST-PATTERN ...99990201, 중복): 기존 prod 고객 `빨강`(5177d86f)에 붙는데, 이 고객 자체가 테스트성. 2건 다 넣을지/1건/0건?
- **확인 C — 동명 다중전화**: `김와사비`(전화 3개)·`로오즈`(2개) = 동일인 반복 셀프접수 의심. 별개 고객으로 둘지 병합할지.
- **확인 D — DUP-SUSPECT check_ins**: `오구리`×2, `빨강`×2 (동일 고객·동일일·동일 status) = 더블탭 의심. 그대로 2건 vs 1건.

### dev-foot 엔지니어 소견 (참고, 결정권 아님)
14 untagged "실데이터"는 이름(까치·로오즈·오구리·춘향이·김와사비·빨강·머루·잣)·전화 패턴(...99990001/0003/0201/1111, 동명 다중)으로 볼 때 **대부분 셀프접수 수기 테스트 입력**으로 보임. `김민경`(01043160981)만 일반적인 실명 형태. prod 오염 우려가 있어 **"전건 폐기"도 합리적 선택지**. 다만 폐기/이관은 대표 confirm 사항.

## 6. 스키마 호환 — INSERT 전 확정 필요 포인트

migrate.sql에 반영했고 supervisor 검증 요청:

| # | 항목 | 처리 | 근거/리스크 |
|---|---|---|---|
| ① | `visit_type` | `'new'` 고정 | HFQ customers에 visit_type 부재. foot enum=new/returning(cust), new/returning/experience(ci). 실제 초/재진 불명 → new 가정 |
| ② | `is_simulation` | `false` | 실데이터 후보로 처리. 테스트로 본다면 true 검토 |
| ③ | `status` 매핑 | `'waiting'`→`'registered'` | **foot check_ins enum에 'waiting' 없음**(consult_waiting/done/treatment_waiting/registered/...). 셀프접수 직후 상태 = registered로 매핑 |
| ④ | `queue_number` | `NULL` | foot 일일 큐번호와 충돌 회피. 컬럼 nullable 확인됨(17 NULL/448) |
| ⑤ | phone format | `+82` E.164 | foot prod 관례(+82...)와 일치 |

## 7. 산출물 / 안전장치

- `migrate.sql` — FORWARD. 더미대역·orphan 제외, 8 cust + 13 ci. dedup guard(prod 중복·재실행 idempotent). **파일 말미 `ROLLBACK;` 고정 → 그대로 실행해도 무변경(dry-run 안전).** GO 후 `COMMIT;` 주석 해제 + STEP3 카운트(8/13) 일치 확인 후 커밋.
- `rollback.sql` — 태그 `[MIGRATE-HFQ-FOOT-20260531]` 기준 정확 역산. child(check_ins)→parent(customers) 순. 기존 prod 고객 5건은 미태깅 → 무영향.
- 모든 INSERT 행에 `[MIGRATE-HFQ-FOOT-20260531] src_(cust|ci)=<hfq_id>` 태깅 → 추적·롤백 1:1.

## 8. 게이트 (불변)

```
[AC-7 패키지(본 문서)] → supervisor 단독 GO → 대표 confirm → INSERT(COMMIT)
```
②(scope 한정)·③(패키지 산출) 충족 — supervisor 라우팅. ⚠️ supervisor GO + 대표 confirm 전 INSERT 절대 금지.
