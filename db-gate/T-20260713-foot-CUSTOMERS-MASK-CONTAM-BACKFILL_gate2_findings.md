# T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 착수 2차 게이트 증거 (§2-0 기계 FK 열거 + 전제 반증)

> READ-ONLY prod 검증 (Management API, UPDATE/DELETE/INSERT 0). PHI 위생(§4): 이름/전화 값 미기재 — 8자 PK·건수만.
> 실행: dev-foot / 2026-07-14 (KST). DA CONSULT-REPLY DA-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL(GO 조건부) 후속.
> ★ 결론: **백필 착수 중단(BLOCK)**. DA GO의 전제("WS-A 13:05 수도꼭지 닫힘")가 데이터로 반증됨. mutation 미실행.

---

## 판정 요약

| 항목 | 결과 |
|---|---|
| §2-0 기계 FK 열거 | ✅ 완료 — customers 참조 FK **32개**(31 테이블). 손열거(check_ins-only) 반증 |
| phantom 자식 실측 | 9개 FK 테이블에 분산. CASCADE FK ~15건 임상 자식 → check_ins-only 재앵커 시 순소실 |
| freeze 윈도우 판정 | ⚠ tz 문자열비교 버그 — "윈도우 내 7건" 신뢰불가 |
| WS-A 수도꼭지 닫힘 전제 | ❌ **반증** — phantom 7건 중 5건이 가드 커밋(13:05 KST) 이후 생성 |
| 백필 착수 | 🚫 BLOCK — 소스 미차단 상태 백필은 SOP 제1원칙 위반 |

---

## 1. §2-0 기계 FK 열거 (손열거 금지 — DA 필수조건 이행)

`pg_constraint`(contype='f', confrelid='public.customers') 카탈로그 기계 열거 결과 = **32개 FK 제약 / 31개 자식 테이블**.
CONSULT 본문이 지목한 `check_ins` 는 그 중 하나일 뿐. 누락되었을 자식군:

- **financial**: `packages.customer_id`, `packages.transferred_to`, `package_payments`, `payments`, `service_charges`, `payment_code_claims`, `insurance_claims`, `insurance_documents`, `insurance_receipts`
- **clinical**: `health_q_results`, `health_q_tokens`, `consent_forms`, `clinical_images`, `prescriptions`, `patient_past_history`, `patient_file_records`, `patient_room_daily_log(patient_id)`, `chart_treatment_requests`, `treatment_photos`
- **memo**: `customer_consult_memos`, `customer_reservation_memos`, `customer_special_notes`, `customer_treatment_memos`, `reservation_memo_history`
- **messaging**: `message_logs`, `notification_logs`, `notification_opt_outs`
- **core**: `check_ins`, `checklists`, `reservations`, `form_submissions`
- **self-ref**: `customers.referrer_id`

### phantom 7건의 실제 자식 (기계 집계, n>0만)

| FK 자식 | 건수 | on_delete |
|---|---|---|
| check_ins.customer_id | 8 | NO ACTION |
| health_q_tokens.customer_id | 6 | **CASCADE** |
| packages.customer_id | 5 | NO ACTION |
| form_submissions.customer_id | 4 | NO ACTION |
| health_q_results.customer_id | 4 | **CASCADE** |
| chart_treatment_requests.customer_id | 2 | **CASCADE** |
| customer_treatment_memos.customer_id | 2 | **CASCADE** |
| customer_consult_memos.customer_id | 1 | **CASCADE** |
| package_payments.customer_id | 1 | NO ACTION |

→ **DA §2-0 경고 구체 실증.** check_ins-only 재앵커 후 dup master 삭제였다면 CASCADE FK
(`health_q_tokens`+`health_q_results`+`chart_treatment_requests`+`customer_treatment_memos`+`customer_consult_memos`) 자식 **약 15건이 순소실**.
(financial `packages`/`package_payments`는 NO ACTION → 삭제 시 RESTRICT abort 되었을 것.)
phantom 들이 패키지 구매·문진·상담/치료 메모까지 축적 = 스태프가 실환자처럼 사용 중.

---

## 2. freeze 윈도우 판정 버그 (tz 문자열비교)

freeze 스크립트(`_freeze_dryrun.mjs`)는 supabase-js 가 UTC ISO(`...+00:00`)로 반환한 `created_at` 을
KST offset 상수(`2026-07-13T13:05:00+09:00`)와 **문자열 사전순 비교**했다 → offset 정규화 없이 비교되어
7건을 전부 "윈도우 내"로 잘못 판정. timestamptz 실비교 시 결과 상이(아래 §3).
→ freeze "윈도우 내 7건" 은 재산출 필요.

---

## 3. 전제 반증 — WS-A 가드는 13:05 에 수도꼭지를 닫지 못했다

WS-A 가드 PROD apply 커밋 `19944923` = **2026-07-13 13:05:05 KST**. 현재 prod 함수
`self_checkin_with_reservation_link` 는 가드 로직 라이브 확인됨(has_masking_guard/sentinel/signal/WS-A comment 전부 true).

그런데 phantom 마스킹 customers 생성시각(KST):

| phantom8 | name 지문 | created (KST) | 가드(13:05) 이후? |
|---|---|---|---|
| 0356b229 | len3 | 07-11 13:09 | 전 |
| 512998d0 | MASKED* | 07-13 09:32 | 전 |
| 67ea1793 | MASKED* | 07-13 14:01 | **후** |
| bd307dfe | MASKED* | 07-13 14:02 | **후** |
| 44a6a076 | MASKED* | 07-13 14:02 | **후** |
| 2dc21d1c | MASKED* | 07-13 14:17 | **후** |
| 02594dfa | len4 | 07-13 18:04 | **후** |

= **7건 중 5건이 가드 커밋 이후 생성.** 이 중 4건은 이름에 `*` 포함(phone heuristic false-positive 아님).

### 5건의 시그니처 = 현재 가드된 함수가 만들 수 없는 형태
5건 전부: `reservation_id = NULL` + `check_ins.customer_name` **마스킹 denorm 저장** + customer 행 마스킹 생성.
현재 가드 함수는 마스킹 감지 시 → customer INSERT 거부 + `check_ins.customer_name='미확인'` sentinel + customer_id NULL.
따라서 이 5건은 **현재 가드 경로에서 나올 수 없음.** 두 가설:

- **(i) apply 무영속 hazard**: 13:05 커밋의 apply 러너가 성공 보고했으나 prod 함수 교체가 실제로 18:04 이후까지 영속되지 않음 (Migration Dry-Run No-Persistence Protocol 경계 케이스). 그렇다면 5건은 **구 self_checkin 함수**(pre-WS-A: 마스킹 name+phone 복합키 매칭→match0→INSERT)에서 나온 것이며 이 시그니처와 정확히 일치.
- **(ii) 두 번째 미가드 벡터**: self-checkin 이 아닌 스태프 워크인/직접 체크인 RPC 가 동일 마스킹 소스(`fn_selfcheckin_today_reservations` 147b3417 마스킹 반환)를 읽어 customers 로 write. WS-A 는 `self_checkin_with_reservation_link` 만 패치.

**어느 쪽이든 "13:05 수도꼭지 닫힘" 전제는 반증됨.** (마지막 마스킹행 = 18:04 07-13, 이후 ~6h+ 신규 0건이나 구조적 차단 미검증.)

---

## 4. 결론 — 백필 착수 BLOCK

Cross-CRM Data-Correction Backfill SOP 제1원칙 = **write-path 수도꼭지 차단이 잔류 백필에 선행**.
소스가 닫힌 시점이 데이터상 13:05 이 아니며(§3), 두 번째 벡터/무영속 hazard 미규명 → 지금 백필하면
새 오염이 계속 유입될 수 있어 무의미(SOP 위반).

### 선행 필요 (DA GO 재조건화 대상)
1. **소스 진짜 닫힘 시점 규명** — (i) WS-A apply 무영속 여부 prod 함수 이력 확인, or (ii) 마스킹 customers 를 만든 실제 write 경로(RPC) 포렌식. → WS-A2 스핀오프 티켓 권고.
2. 진짜 닫힘 시점 이후 **신규 마스킹 유입 0 재확인** (freeze 재산출, timestamptz 정확 비교).
3. 그 후에야 dry-run(BEGIN..ROLLBACK, 32 FK 전량 re-anchor) → per-row confirm → supervisor 최종게이트.

mutation/deploy-ready 미실행 유지. 본 게이트는 READ-ONLY 검증 전용.
