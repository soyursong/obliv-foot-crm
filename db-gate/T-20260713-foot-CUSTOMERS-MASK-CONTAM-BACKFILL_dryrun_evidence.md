# T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 백필 dry-run 증거 (READ-ONLY)

> READ-ONLY dry-run (`scripts/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_dryrun.mjs`, Management API).
> **mutation 0 / persistence NONE (SELECT-only)**. UPDATE/DELETE/INSERT 없음.
> PHI 위생(§4): git 워킹 아티팩트에는 **count/PK8 리스트만**(redacted). name/phone-shape 값 = off-git 스냅샷(per-row confirm 시 생성).
> 실행: dev-foot / 2026-07-14 KST. 게이트 (b) — DA light re-confirm(a)와 병행.
> ★ GO 재확인 前 mutation/deploy-ready 미실행. 본 문서 = dry-run 스냅샷 전용.

---

## 결론 요약

| 항목 | 결과 |
|---|---|
| 대상셋 freeze 재확인 (tz 정확비교) | masked customers **7건** (freeze 불변) |
| §2-0 기계 FK 열거 | customers 참조 FK **32개 / 31 테이블** (손열거 반증, gate2 확증) |
| CASCADE FK | **16개** (phantom 자식 중 순소실 위험 **15행** — re-anchor로 전량 구제) |
| phantom 자식 총계 | **33행** (9개 FK 테이블 분산) |
| 복구 해소 | **6 RESOLVABLE / 1 HOLD(02594dfa)** — DA 정정규칙과 정합 |
| ⚠ reservation_id 결정키 | **전 phantom 0건** — self_checkin이 resv_id NULL로 생성(포렌식 확증). 복구는 phone_tail4+clinic 단일수렴 + name-stem/temporal 보강에 의존 |
| mutation | **0** (persistence NONE) |

---

## [0] 대상셋 freeze 재확인 (masked customers, timestamptz 정확비교)

window(KST) = `2026-07-11 00:00:00+09` ~ `2026-07-13 18:04:46+09` (실 윈도우 END = phase1 재산출 ~18:04, tz 정확)

| # | id(8) | name 지문 | phone_tail | created_kst | in_window |
|---|---|---|---|---|---|
| 0 | 0356b229 | len3(비마스킹) | 9089 | 07-11 13:09:47 | ✅ |
| 1 | 512998d0 | MASKED(*) | 5453 | 07-13 09:32:49 | ✅ |
| 2 | 67ea1793 | MASKED(*) | 0011 | 07-13 14:01:51 | ✅ |
| 3 | bd307dfe | MASKED(*) | 2200 | 07-13 14:02:01 | ✅ |
| 4 | 44a6a076 | MASKED(*) | 1122 | 07-13 14:02:13 | ✅ |
| 5 | 2dc21d1c | MASKED(*) | 0101 | 07-13 14:17:22 | ✅ |
| 6 | **02594dfa** | len4(비마스킹) | 0000 | 07-13 18:04:45 | ✅ |

→ **7건 전부 오염 대상셋 확정**(6 resolvable / 1 ambiguous). freeze 대상셋 불변, 근거만 tz 정정.

---

## [1] §2-0 기계 FK 열거 (pg_constraint contype='f' → customers)

FK 제약 **32개 / 자식 테이블 31개**. CASCADE FK **16개**:
`chart_treatment_requests · clinical_images · customer_consult_memos · customer_reservation_memos · customer_special_notes · customer_treatment_memos · health_q_results · health_q_tokens · insurance_claims · message_logs · notification_opt_outs · patient_file_records · patient_past_history · patient_room_daily_log(patient_id) · reservation_memo_history · treatment_photos`

### phantom 7건의 실제 자식 (기계 집계, n>0)

| FK 자식 | 건수 | on_delete |
|---|---|---|
| check_ins.customer_id | 8 | NO ACTION |
| health_q_tokens.customer_id | 6 | CASCADE |
| packages.customer_id | 5 | NO ACTION |
| form_submissions.customer_id | 4 | NO ACTION |
| health_q_results.customer_id | 4 | CASCADE |
| chart_treatment_requests.customer_id | 2 | CASCADE |
| customer_treatment_memos.customer_id | 2 | CASCADE |
| customer_consult_memos.customer_id | 1 | CASCADE |
| package_payments.customer_id | 1 | NO ACTION |

- 총 자식 **33행** · CASCADE 순소실 위험 **15행**(re-anchor로 구제).
- check_ins-only 재앵커였다면 dup master 제거 시 CASCADE 15행 순소실 — **§2-0 손열거 금지 규율이 사고 차단**(gate2 확증 재현).
- financial `packages`/`package_payments`(NO ACTION) = 삭제 시 RESTRICT abort → 순소실 아닌 명시적 abort.

---

## [2] per-phantom 복구소스 해소 (reservation_id 결정키 우선 → phone tail4 보강)

> name_stem(성명 초·말자) = name-shape PII → off-git 스냅샷에만 기재(§4). 아래는 존재여부·정합만.

| id(8) | resv_cands | phone_cands | raw_id(8) | name_stem 정합 | created_gap_s | status |
|---|---|---|---|---|---|---|
| 0356b229 | 0 | 1 | c51dd5e0 | off-git | 70982 (~19.7h) | RESOLVABLE |
| 512998d0 | 0 | 1 | 8fa12f4c | off-git (masked name과 정합) | 39 (~39s) | RESOLVABLE |
| 67ea1793 | 0 | 1 | 7ad9e9a4 | off-git | 13991 (~3.9h) | RESOLVABLE |
| bd307dfe | 0 | 1 | d916d27b | off-git | 14027 (~3.9h) | RESOLVABLE |
| 44a6a076 | 0 | 1 | d2ba1e9a | off-git | 966424 (~11.2d) | RESOLVABLE |
| 2dc21d1c | 0 | 1 | 38e1a858 | off-git | 14819 (~4.1h) | RESOLVABLE |
| **02594dfa** | 0 | 0 | — | — | — | **HOLD_PERROW** |

### ⚠ 결정키 부재 — 중대 소견
- **reservation_id → reservations.customer_id 결정키 = 전 phantom 0건.** self_checkin이 `reservation_id` NULL로 phantom을 생성(포렌식 §2 확증) → DA Q2 1순위 결정경로가 데이터상 존재하지 않음.
- 6건 RESOLVABLE = 전적으로 **phone_tail4 + clinic 단일수렴**(각 정확히 1 raw 후보) + name-stem/temporal 보강신호 의존.
- DA Q2가 phone tail4를 "보강신호(검증용)만, destructive 결정키 아님"으로 분류 → **auto-merge 배치 처리 부적절, 6건 전량 per-row 사람 confirm 필수**(§2-F 준용). 특히 temporal gap 큰 2건(44a6a076 ~11d, 0356b229 ~19.7h)은 보강 약함 → confirm 강도 상향.
- → DA light re-confirm 시 **이 소견을 반영해 GO 조건 재판단** 필요(아래 supplement 발행).

---

## [3] 재앵커 시뮬레이션 (무영속, §2-3-b 순서 불변식)

각 RESOLVABLE phantom → raw 재앵커 검증 (raw 존재=1·non-masked·distinct 전건 통과):

| phantom(8) | → raw(8) | 이동 자식 | raw 존재 | raw_masked | check_ins denorm 마스킹잔존 |
|---|---|---|---|---|---|
| 0356b229 | c51dd5e0 | 4 | 1 | false | 1 |
| 512998d0 | 8fa12f4c | 4 | 1 | false | 1 |
| 67ea1793 | 7ad9e9a4 | 7 | 1 | false | 1 |
| bd307dfe | d916d27b | 5 | 1 | false | 1 |
| 44a6a076 | d2ba1e9a | 2 | 1 | false | 2 |
| 2dc21d1c | 38e1a858 | 5 | 1 | false | 1 |

**§2-3-b 순서 불변식 (apply 시 각 phantom별)**:
1. 전 32 FK 자식 raw로 **비파괴 FK-only UPDATE** (customer_id/patient_id: phantom→raw).
2. dup master(phantom)가 전 32 FK에서 자식 **0건 재검증** — 하나라도 잔존 시 **abort**.
3. archive-first 제거(`_backup` 테이블 or off-git JSON, 순소실0 검증 후).
   - + check_ins denorm(`customer_name`/`customer_phone`) 마스킹 잔존을 raw 값으로 refresh (class A 미러재링크, denorm 정합).

---

## [HOLD] 02594dfa (§2-F per-row, INV-3 fail-closed)

- resv_cands=0 / phone_cands=0(tail 0000 = DUMMY 후보 다수 → 제외) / name_len4 비마스킹 / created 18:04:45.
- **INV-3 fail-closed**(0 후보) → auto-merge 금지. per-row 사람 confirm 필수.
- test/DUMMY 확증 시 no-re-anchor archive test-purge 가능(DA Q3 승인) — 단 판정근거 스냅샷(off-git)에 test/DUMMY 근거 동봉 후 사람 confirm.

---

## 게이트 상태 & 다음

- (a) DA light re-confirm: 발행 완료 (MSG-20260714-012326-ttw7) + **결정키부재 소견 supplement 발행**.
- (b) dry-run READ-ONLY: **완료(본 문서)**.
- (c) per-row confirm: DA GO 재확인 후 — off-git PHI 스냅샷(dup_id·raw_id·매칭근거·delta·기계열거 전FK자식건수·test/DUMMY 근거) 생성 → 6건 + 02594dfa 사람 confirm.
- (d) supervisor 최종게이트: apply 후 (MIG-GATE 4필드 + 롤백 SQL).

**mutation/deploy-ready 미실행 유지. GO 재확인 前 금지.**
