# Step2 backfill 완료 + Step3 VALIDATE 준비 — dev-foot (2026-07-18)

티켓: T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
계기: supervisor QA-REPLY MSG-20260718-195128-1twh (parent CHK-UNENFORCED 진성-deployed 확정 → Step2 재개 GO, CEO 6pca 승계).
근거 SOP: `data_correction_backfill_sop` v1.7 전 항목 준수.
PHI 위생(§4): 실 phone 값·freeze PK·before/after image = OFF-GIT (`~/foot-backfill-artifacts/T-20260713-PHONE-E164/`). 본 문서 = 카운트/판정만.

---

## 0) 착수 게이트 (전부 통과)
| 게이트 | 결과 | 근거 |
|--------|------|------|
| CEO 승인 | ✅ 승계 (MSG-20260714-140646-6pca, 재승인 불요) | 티켓 L15 |
| P-A 실효확증 (enforcement live) | ✅ ALL PASS (2026-07-18T10:39Z) | 티켓 L142~159 |
| P-B neg-window (SOP §0-2 소스닫힘) | ✅ PASS — enforcement 시각↑ 신규 비-E.164 **0건** (tz-aware) | `_PB_forensic.mjs` |

## 1) FREEZE (§3-1) — 현재 suspect set 명시 PK 박제
| 테이블 | suspect total | NORMALIZE | RESIDUAL |
|--------|--------------|-----------|----------|
| customers.phone | 29 | 18 | 11 |
| reservations.customer_phone | 98 | 92 | 6 |

- 정정후값 결정(per-row triage):
  - **NORMALIZE**: KR-mobile 미정규화 → `+82` E.164 (결정적 transform, dryrun candidate = KR E.164 regex 검증).
  - **customers RESIDUAL (11)**: 전부 junk(4자리 `9089`·`5453` 등 / allzero `0000`·`000-0000-2200`) = 진성 전화번호 아님 → `DUMMY-<uuid>` (시스템 native dummy 규약, UNIQUE-safe, 트리거 `is_dummy_phone`가 `phone_dummy=true` 파생). **강제 정규화 금지**(§2-F under-correct≫over-correct).
  - **reservations RESIDUAL (6)**: 전부 junk(`0`·`000`·`000-0001-1111`) → **NULL** (nullable·CHECK-permitted·정직).

## 2) §3-5 CHECK-domain PREFLIGHT (필수승격) — ALL PASS
touched 컬럼(phone/customer_phone)의 정정후값 전수를 verbatim-pull 제약에 Postgres 사전평가:
| 게이트 | customers | reservations | 판정 |
|--------|-----------|--------------|------|
| ① CHECK verbatim (pg_get_constraintdef self-eval) | 0 offender | 0 offender | ✅ |
| ② NOT NULL (customers.phone) | 0 offender | n/a (nullable) | ✅ |
| ③ UNIQUE(clinic_id,phone) 기존셋 충돌 | 0 | n/a | ✅ |
| ③ UNIQUE(clinic_id,phone) freeze 내부 충돌 | 0 | n/a | ✅ |

- ★ scalp2 W5 선례(정규화불가행 apply-時 23514/23505/23502 FATAL) 사전차단: 11 junk 를 `+821000000000` 로 수렴하면 **동일 clinic 12-way UNIQUE 위반**(해당 clinic 기존 sentinel 1건) → `DUMMY-<uuid>` per-row-unique 로 회피.

## 3) APPLY (§3-3 멱등 · §5-8 재-스윕 · §4 원장무접점)
- apply 직전 재-스윕: customers match-old=29 / reservations match-old=98, **drift=0** → clean.
- UPDATE (set-based FROM VALUES, `WHERE id=id AND col=old`): **customers changed=29 · reservations changed=98**.
- 멱등 재실행 확인: 2회차 changed=0 (already-applied=29/98).
- DDL 0 (순수 데이터 UPDATE) → schema_migrations 원장 미소비.

## 4) 사후 정합검증 — ALL PASS
| 항목 | 결과 |
|------|------|
| 잔존 비-E.164 위반 (suspect predicate) | customers=**0** / reservations=**0** |
| full-table CHECK verbatim 위반 | customers=**0** / reservations=**0** (VALIDATE 준비 완료) |
| phone_dummy 파생 (트리거) | NORMALIZE=false×18 / RESIDUAL=true×11 (정합) |

## 5) §8 파생층 전파 (DoD)
- customers/reservations 정정은 `trg_updated_at` 이 `updated_at` **bump** (동결 아님) → Bronze updated_at-watermark 자연 전진 → **자기치유 재수집**(NOSHOW-CHECKIN 선례 동형). id-scoped 강제 re-ingest 불요.
- ⚠ customers 정정은 `trg_updated_at` 만 발화(phone-only UPDATE). reservations 는 customer_phone-only UPDATE → dopamine callback 트리거(status/reservation_date 조건)는 **미발화** (부작용 없음).
- INFO: bronze/silver 는 watermark 자연 재수집으로 정정값 반영(별도 강제 조치 불요, 관측만).

## 6) Step3 VALIDATE (ADDITIVE) — 제출 (supervisor DDL-diff 게이트 대기)
- 마이그: `supabase/migrations/20260718220000_foot_phone_e164_validate.sql`
  - `ALTER TABLE ... VALIDATE CONSTRAINT` ×2 (SHARE UPDATE EXCLUSIVE, 비블로킹 스캔). convalidated false→true.
- dry-run (no-persistence protocol): `..._step3_dryrun.mjs` → **✅ DRYRUN PASS**
  - 사전 convalidated=false → DO 내 VALIDATE 성공(위반 0) → sentinel `DRYRUN_SENTINEL_OK` RAISE 롤백 → 사후 convalidated=false (**무영속 실증**).
- rollback: `..._validate.rollback.sql` (DROP + verbatim NOT VALID 재-ADD = parent 정본식).
- **다음**: supervisor DDL-diff 게이트 GO 후 dev-foot `applyMigration()` 적용 → 원장 기록 → convalidated=true 사후검증 → deployed 마킹.

## 재현 스크립트 (git-tracked)
- `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_PB_forensic.mjs` (P-B, READ-only)
- `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_freeze_preflight.mjs` (freeze + §3-5, READ-only)
- `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_apply.mjs` (`--apply` 로 write)
- `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_step3_dryrun.mjs` (Step3 no-persist evidence)
