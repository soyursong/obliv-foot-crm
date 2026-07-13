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

| # | phantom(8) | → raw(8) | tail4 | tail4+clinic 후보수 | FK 자식 | temporal gap | name-stem | verdict (C7 라이즈드바) |
|---|---|---|---|---|---|---|---|---|
| 1 | 0356b229 | c51dd5e0 | 9089 | **1** | 4 | ~19.7h *(약보강: temporal 무효)* | 성·끝·visible substr 일치(len3) | **ADOPT** — tail4+clinic 단일 + name-stem (temporal 배제 후에도 ≥2 수렴) |
| 2 | 512998d0 | 8fa12f4c | 5453 | **1** | 4 | ~39s | 성·끝 일치 | ADOPT — tail4+clinic 단일 + name-stem + temporal |
| 3 | 67ea1793 | 7ad9e9a4 | 0011 | **1** | 7 | ~3.9h | 성·끝 일치 | ADOPT — tail4+clinic 단일 + name-stem + temporal |
| 4 | bd307dfe | d916d27b | 2200 | **1** | 5 | ~3.9h | 성·끝 일치 | ADOPT — tail4+clinic 단일 + name-stem + temporal |
| 5 | 44a6a076 | d2ba1e9a | 1122 | **1** | 2 | ~11.2d *(약보강: temporal 무효)* | 성·끝 일치 | **ADOPT** — tail4+clinic 단일 + name-stem (temporal 배제 후에도 ≥2 수렴) |
| 6 | 2dc21d1c | 38e1a858 | 0101 | **1** | 5 | ~4.1h | 성·끝 일치 | ADOPT — tail4+clinic 단일 + name-stem + temporal |
| — | **02594dfa** | — (HOLD) | 0000 | (후보 6 DUMMY) | (6, 본 배치 제외) | — | — | **HOLD_PERROW** (§2-F, 후보 6 DUMMY) |

> ⚠ **舊 apply-prep(RESOLVABLE "gap 큼→강한 confirm") 판정 정정.** DA addendum(MSG-20260714-013056-zbn9)은 temporal gap이 **클수록 temporal 보강력을 잃는다**로 명시(舊 반대논리 폐기). #1(~19.7h)·#5(~11.2d)는 약보강행 강등규율 대상 → temporal을 채택근거로 쓰지 않고 **tail4+clinic 단일 + name-stem 교차확인**만으로 clean single convergence 재판정. probe 실측 결과 두 행 모두 tail4+clinic 후보=정확히 1 + name-stem(성·끝글자, #1은 visible substr까지) 일치 → temporal 배제 후에도 ≥2 독립신호 정확단일수렴 성립 → **ADOPT 유지(강등 불요)**. clean single 미성립 시엔 HOLD 강등이었을 것.

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

## C7 라이즈드바 반영 (DA addendum MSG-20260714-013056-zbn9, 2026-07-14 KST)

DA supplement(MSG-20260714-012746-0dsq, 결정키 reservation_id 전건 부재)에 대한 회신:
**GO 유효(RE-CONFIRMED 그대로) + Q2/Q3 강화 addendum. 신규 verdict 불요.** dev-foot 격상 판단 승인.
- **(2) 6건 batch→per-row 전량 격상 승인(의무).** 결정키 부재로 6건 전부 auto-merge 자격 상실 → 전량 fallback. **배치 auto-merge 경로 본 대상셋에서 폐쇄.**
- **(3) tail4+clinic 단일수렴 + name-stem 을 per-row 채택근거로 인정, 승격 바 상향:**
  - INV-3 정확단일수렴(비협상): ≥2 보강신호가 정확히 1 raw 후보 수렴 시만 채택, ≥2 후보 → HOLD.
  - tail4 충돌가드: `phone_tail4+clinic` non-masked raw master 정확히 1건(≥2 → HOLD). name-stem·temporal은 그 단일수렴의 교차확인으로만, 단독 tie-break 승격 금지.
  - 약보강행 강등규율: temporal gap 클수록 temporal 보강력 상실 → #1(~19.7h)·#5(~11.2d)는 `tail4+clinic+name-stem`만으로 판정, clean single 미성립 시 temporal로 메우지 말고 HOLD 강등.

**집행(dev-foot):**
1. **라이즈드바 probe(READ-ONLY)** `scripts/..._raisedbar_probe.mjs` → `db-gate/..._raisedbar_result.json`(count/PK8만). 6행 전부 tail4+clinic 후보=정확히 1, name-stem(성·끝글자) 일치. **0 강등, 6/6 ADOPT.** 약보강 2건(#1·#5)도 temporal 배제 후 ≥2 신호(tail4+clinic 단일 + name-stem) 정확단일수렴 성립.
2. **tail4 충돌가드 마이그 기계집행 추가**: G0 루프에 phantom 제외 동 clinic·non-masked·8+digit·동일 tail4 후보 `count=1` 아니면 ABORT. 집행시점 재검증(probe 시점값 신뢰 금지). mutation dry-run 재실행 PASS(delta 27/7/6 불변, 무영속), rollback 라운드트립 PASS(6/6 복원).
3. **off-git per-row 스냅샷 갱신**: `~/foot-phi-offgit/..._perrow_confirm.json` — 행별 tail4+clinic 후보수·name-stem·temporal delta·test/DUMMY 근거·verdict + `human_confirm=PENDING`(6 ADOPT + 02594dfa HOLD).

**C1~C6 전부 유효(RECONFIRM 그대로). C7 추가 충족.** 02594dfa=§2-F per-row 변경 없음.

## 남은 게이트 (apply 前 필수)

1. **(c) per-row 사람 confirm** — off-git 스냅샷(`~/foot-phi-offgit/..._perrow_confirm.json`) 6 ADOPT + 02594dfa HOLD, 전 `human_confirm=PENDING`. **배치 auto-merge 금지(C7)** — 각 행 per-row 채택근거(INV-3 단일수렴·tail4 충돌가드·name-stem 교차확인) 스냅샷 첨부. 미충족 행은 dev 판단으로 HOLD 가능(재-CONSULT 불요).
2. **(d) supervisor 최종게이트** — MIG-GATE 4필드 + C6 post-probe로 실 apply. Step=DESTRUCTIVE(relink+archive-first delete) → supervisor DB-GATE.

**per-row confirm + supervisor GO 前 apply/deploy-ready 금지.**
