# T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — apply-prep 증거 (DA RE-CONFIRMED GO 후)

> dev-foot / 2026-07-14 KST. DA `GO(조건부) RE-CONFIRMED` (MSG-20260714-012820-amra) 수신 → 舊 SUSPENDED 해제.
> 절차: 재확인 GO → **C1 freeze 재검증 → C2 소스 재확인 → C3 FK 재열거 → mutation dry-run(BEGIN..ROLLBACK) → rollback 라운드트립** (여기까지 완료) → **per-row confirm(사람)** → **apply(supervisor MIG-GATE + C6 post-probe)**.
> PHI 위생(§4): 본 git 아티팩트 = **count/PK만**. 실명·전화 = off-git 스냅샷.
> ★ mutation 미실행. 실 apply = supervisor 최종게이트. 본 문서/마이그 = apply-prep.

---

## DA carry-forward 조건 이행 매트릭스

| 조건 | 내용 | 상태 | 증거 |
|---|---|---|---|
| **C1** | freeze 재검증 (tz-aware, corrected window ≤~18:04, 7 PK 불변) | ✅ PASS | 집행시점 재-SELECT — 7 PK 정확히 불변(6 resolvable/1 hold). drift 0 |
| **C2** | 소스 continuously-closed (마지막 오염 16:32:46 이후 신규 마스킹 0 연속) | ✅ PASS | 마지막 name-masking `dbca2465`@16:32:46 KST. frozen window end(18:04:45) 이후 masking-signature 신규 0건. 집행시점(01:33 KST 07-14) ~9h clean |
| **C3** | 기계 FK 재열거 (pg_constraint contype='f' confrelid=customers) | ✅ 32개 | 32 FK / 31 자식테이블 (self-ref `customers.referrer_id`·`packages.transferred_to`·비표준 `patient_room_daily_log.patient_id` 포함). 손열거였다면 누락 위험 실증 |
| **§2-3-b** | 순서 불변식 (전 FK raw re-anchor → dup master 0건 재검증 → archive-first remove) | ✅ 구현+실증 | mutation dry-run에서 abort 없이 통과(잔존 자식 0 확인 후 delete) |
| **C4** | 02594dfa §2-F per-row + Auth Identity fail-closed(≥2/0 후보 → auto-merge 금지) | ✅ 격리 | HOLD. 본 마이그 **제외**. phone tail 0000 후보 6건(DUMMY) → per-row/test-purge 결정 |
| **C5** | 스냅샷·롤백 (archive-first, off-git PHI / git=count·PK, tracked schema 무접촉) | ✅ | `_backfill_mask_contam_*` 3표(별도, tracked schema 무접촉). rollback.sql movelog 역주행 |
| **C6** | persistence 확증 (dry-run PASS 불신 + post-probe 독립 실측) | ✅ PASS | sentinel-RAISE 전체롤백 + post-probe: phantom 6 잔존·_backfill 표 0 = 무영속 |

---

## 대상셋 (freeze 재확인, 집행시점 불변)

phantom→raw 매핑 (UUID PK만 — phone_tail4+clinic 단일수렴, per-row confirm 대상):

| # | phantom(8) | → raw(8) | tail4 | FK 자식 | temporal gap | verdict |
|---|---|---|---|---|---|---|
| 1 | 0356b229 | c51dd5e0 | 9089 | 4 | ~19.7h | RESOLVABLE (gap 큼→강한 confirm) |
| 2 | 512998d0 | 8fa12f4c | 5453 | 4 | ~39s | RESOLVABLE |
| 3 | 67ea1793 | 7ad9e9a4 | 0011 | 7 | ~3.9h | RESOLVABLE |
| 4 | bd307dfe | d916d27b | 2200 | 5 | ~3.9h | RESOLVABLE |
| 5 | 44a6a076 | d2ba1e9a | 1122 | 2 | ~11.2d | RESOLVABLE (gap 큼→강한 confirm) |
| 6 | 2dc21d1c | 38e1a858 | 0101 | 5 | ~4.1h | RESOLVABLE |
| — | **02594dfa** | — (HOLD) | 0000 | (6, 본 배치 제외) | — | **HOLD_PERROW** (§2-F, 후보 6 DUMMY) |

---

## mutation dry-run 결과 (BEGIN..ROLLBACK, C6)

`scripts/..._mutation_dryrun.mjs` (sentinel-RAISE 무영속):

```
MUTATION_DRYRUN_RESULT: {"sentinel_rollback":true,"persistence":"NONE","phantom_survive":6,"backfill_tables":0}
시뮬 delta: FK 자식 relink=27 · check_ins denorm refresh=7 · phantom 삭제=6
```

- 27 = 4+4+7+5+2+5 (6 phantom FK 자식). 02594dfa 자식 6건은 제외 → 전 dry-run 33행과 정합.
- §2-3-b (2) 잔존 자식 0건 재검증 통과(abort 미발생) → CASCADE 순소실 0.
- **post-probe 독립 실측**: phantom 6 잔존 · `_backfill_*` 표 0 = 영속 0 확증.

## rollback 라운드트립 (apply 前 역주행 실증)

`scripts/..._rollback_roundtrip.mjs` (단일 txn: forward→rollback→assert→sentinel 롤백):

```
ROUNDTRIP_RESULT: {"rollback_correct":true,"persistence":"NONE"}
phantom 복원=6/6 · check_ins phantom 복귀=7(≥6) · post-probe 무영속=6
```

## 3자 원장 대조 (mig_ledger_check, pre-apply)

- 마이그 파일: `20260714020000_foot_customers_mask_contam_backfill.sql` (신규)
- schema_migrations: `20260714020000` **부재** (미적용 — 기대) / ledger tip = `20260713170000`
- prod 실재: `_backfill_mask_contam_*` 표 **0건** (무영속 확인)
- → 3자 정합(전부 미적용 상태). apply 시 supervisor MIG-GATE가 실영속·post-probe 재실측.

---

## 남은 게이트 (apply 前 필수)

1. **(c) per-row 사람 confirm** — off-git 스냅샷(`~/foot-phi-offgit/..._perrow_confirm.json`) 6 RESOLVABLE + 02594dfa HOLD, 전 `human_confirm=PENDING`. auto-merge 금지, temporal gap 큰 2건(#1·#5) 강한 확인.
2. **(d) supervisor 최종게이트** — MIG-GATE 4필드 + C6 post-probe로 실 apply. Step=DESTRUCTIVE(relink+archive-first delete) → supervisor DB-GATE.

**per-row confirm + supervisor GO 前 apply/deploy-ready 금지.**
