# VG1~VG5 census + SOP 봉투 evidence — T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI

- **owner**: dev-foot · **date**: 2026-08-09 · **change_class**: DATA_CORRECTION_BACKFILL · **db_change**: true · DDL 0 (single-row DML) · **artifact_class**: db_only
- **DA GO**: `agents/docs/da_replies/da_decision_foot_heo4717_2e8f7aa5_cis_create_kimgyuri_20260809.md` — verdict = **Q1 GO (조건부·verify-gated)**, ball=dev-foot (SOP 봉투 구성)
- **CONSULT-REPLY**: MSG-20260809-100435-eiay (data-architect → dev-foot)
- **gate order (DA §7)**: DA GO → **SOP 봉투(VG1 archive-first + VG3 dry-run No-Persistence + VG4 acceptance oracle + 판정근거 스냅샷)** → 박민지/총괄 per-row comp-gate → **supervisor DB-GATE GO-token** → dev prod apply(guard chokepoint) → applied_at + POSTCHECK → deployed
- **probe**: `scripts/T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI_vg_census.mjs` (SELECT-only, prod write 0) → evidence json 동봉
- **apply(staged, un-applied)**: `supabase/migrations/20260809100000_foot_heo4717_2e8f7aa5_ctb_cis_create.sql`
- **rollback**: `supabase/migrations/20260809100000_foot_heo4717_2e8f7aa5_ctb_cis_create.rollback.sql`
- **VG4 오라클 dry-run**: `db-gate/T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI_vg4_acceptance_oracle_dryrun.sql`

## resolved ids (prod-confirmed)
| 항목 | id | 값 |
|---|---|---|
| payment | `2e8f7aa5-3e83-4d4a-8900-ab1f0048694a` | 15,000 · active · card(payment_type=payment) · created 07-28 · accounting 08-06 · parent NULL |
| 부모 check_in | `c33dfc76-cda5-48e6-9b34-277281b26626` | checked_in_at 2026-07-28(KST 10:19) · returning · done · therapist=김규리 |
| customer (F-4717) | `6412fbf7-8a53-4d49-af7a-491e1d731b4c` | 현은호 |
| clinic (종로) | `74967aea-a60b-4da3-a0e7-9c997a930bc8` | |
| service CTB | `e17ba3a3-4842-4097-87bc-0778a64d2755` | Care Toe Band (CTB) · price 15,000 · category 기타 / label 풋화장품 · active |
| seller (김규리 therapist) | `3a0c6774-2bd9-4018-bb38-ef6fab75d04b` | DA Q4 확정 |
| 신규 cis id (staged) | `070652f3-3cb0-414a-ad80-98bf4c967e59` | 고정 PK (멱등 + rollback 타깃) |

---

## VG1 — archive-first (before-image) = **CAPTURED**
c33dfc76 현 cis **6행** (롤백 원본) — CTB **없음**(`vg1_cis_has_ctb=false`):
1. 재진-물리치료,주사 등 (1a82c70a) 4,690
2. 비가열성 진균증 레이저 치료 (ee5f26d0) 240,000 (original 300,000)
3. 손발톱백선 (2fd9c05d) 0
4. 발백선 (853ede8a) 0
5. (비급여) 바르토벤외용액 4mL (c812b085) 0
6. 터미졸크림(테르비나핀) (f8cac105) 0

INSERT 라 소실 원천 없음 → rollback = 신규 id DELETE(1행), 순소실 0.

## VG2 — freeze-set = **PASS** (apply 직전 재-freeze DRIFT ABORT 대상)
- payment 2e8f7aa5 = 15,000 active (旣존재) — **payment 재INSERT 금지**(이미 v_daily_revenue[07-28] 1회 계상).
- check_in c33dfc76 = 07-28 · therapist 3a0c6774(김규리) · done.
- service e17ba3a3 = CTB · price **15,000** · active · 풋화장품.

## VG3 — No-Persistence dry-run = **artifact 준비완료** (supervisor DB-GATE 실행)
`..._vg4_acceptance_oracle_dryrun.sql` = DO 블록(INSERT→측정→RAISE EXCEPTION 강제 ROLLBACK). COMMIT/txn-control 없음 = sentinel-bypass 불가. 사후 post-probe 로 무영속 재확인.

## VG4 — acceptance oracle baseline = **CAPTURED** (dry-run 에서 delta 실증)
| oracle | baseline(현재) | apply 후 EXPECT |
|---|---|---|
| (a) v_daily_revenue[07-28] single_revenue (종로) | **8,441,360** (15,000 payment 이미 포함) | delta **0** (cis 미참조) |
| (b) payments count (c33dfc76) | — (dry-run 측정) | delta **0** (2번째 결제 자동생성 0) |
| (c) service_charges count (c33dfc76) | **1** (재진 진찰료) | delta **0** (CTB 명세 자동파생 0) |
| (d) 김규리(3a0c6774) 화장품 breakdown sum | **349,000** (17라인, c33dfc76 미포함) | **+15,000** = 364,000 (18라인) |
| (e) c33dfc76 하 CTB cis | **0건** (`vg4e_ctb_absent=true`) | 1건 (CREATE 대상 무→유) |

## 검토 B (side-effect, DA §1-4) = **code-proven** (re-CONSULT #1/#2 부재)
`grep CREATE TRIGGER ... ON check_in_services` = **0건** (supabase/migrations 전량). RLS policy + index 만 존재. → cis INSERT 는 **DB 트리거를 발화하지 않음** → payment/service_charge 자동파생 경로 부재. (dry-run 오라클이 empirical 재확인.)

## VG5 — seller provenance = **RESOLVED** (DA Q4 CONFIRM, attestation 불요)
clinic 74967aea 김규리 **2행**: therapist `3a0c6774`(check_in c33dfc76 결속·방문 결속) / admin `d26717cb`(배제). seller_staff_id = **3a0c6774**. seller = mutable 판매귀속 → §416 `created_by`(방화벽)/registrar 축과 **직교**(방화벽 물리 write 아님). 자매 F4741 과 달리 동명이인 attestation BLOCKER 없음(방문 결속 = 부모 진단 dispositive).

## 값 provenance (창작 0) — DA Q3 acceptable
service e17ba3a3 카탈로그 15,000 == payment 2e8f7aa5.amount == 기존 CTB 라인(76199926, seller 3a0c6774) parity. 표시월 = **7월**(checked_in_at 07-28) — 08월 check_in 신설 = 데이터왜곡 HARD 금지.

---

## 종합
- **VG1/VG2/VG5 = PASS · VG4 baseline CAPTURED · 검토 B code-proven.** 값 창작 0.
- **apply 미착수** (apply_before_go 금지 — supervisor DB-GATE GO-token 前 prod DML 0). deploy-ready 미마킹.
- **다음 게이트** (dev 소관 밖): (1) 박민지/총괄 per-row comp-gate (seller=인센티브-인접; T-20260804 '표=참고용' waive 선례) + "표시월=7월(07-28)" 총괄 확인 1회. (2) supervisor DB-GATE: VG4 오라클 dry-run 실행(4 delta 검증) → GO-token 발행. (3) GO-token 수신 후 dev prod apply(guard chokepoint) → applied_at + POSTCHECK.
- **HARD ABORT / re-CONSULT 트리거**: VG4(a) delta≠0 / VG4(b) payments +1 / cis+payments 합산 신규뷰 발견 / seller 가 §416 방화벽 물리 write 요구 / Q3 provenance 총괄 불일치.
