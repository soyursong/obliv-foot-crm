# T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY — DB-GATE evidence + (a)/(b) SOP

- 수행: dev-foot / 2026-07-24. **apply 산출(ADDITIVE)** — hold-registry SSOT 테이블 + BEFORE UPDATE fail-closed 트리거 + (b)ledger SOP + (a)predicate 제외 표준.
- APPLY-GATE 충족: **DA CONSULT-REPLY=GO_CONDITIONAL (MSG-20260724-071451-fbr2)** 수신 확인 → apply 착수(대표 게이트 면제 autonomy §3.1, ADDITIVE·단일 CRM foot·cross-product 충돌 0).
- 설계 SSOT: `db-gate/T-20260724-foot-DUMMY-NORMALIZE-OOB-HOLD-GUARD_forensics-and-design.md` (commit 94da0c74)
- DA 정본 결정: `agents/docs/da_replies/DA-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY.md`

---

## 산출 파일 (mig_files)
| 파일 | 역할 |
|---|---|
| `supabase/migrations/20260724120000_foot_data_correction_hold_registry_guard.sql` | up — hold-registry 테이블 + partial-unique + 함수 + BEFORE UPDATE 트리거 (ADDITIVE) |
| `…_guard.rollback.sql` | 롤백 — DROP TRIGGER + DROP FUNCTION + DROP TABLE (순손실 0) |
| `…_guard.dryrun.sql` | 무영속 회귀행렬 6종(단일 DO 블록·RAISE unwind) |
| `…_guard.seed.sql` | freeze-window ROW1 등록 템플릿(:row1_id 주입, gated) |
| `scripts/T-20260724-foot-HOLD-GUARD-APPLY_dryrun.mjs` | dry-run 러너(Management API·무영속·POST-PROBE) |

## DA 하드닝 체크리스트 9종 — 반영 대사 (supervisor 집행)
| # | 조건 | 반영 |
|---|---|---|
| 1 | surrogate PK + `uq_hold_active` partial-unique(active 중복 차단·이력 누적) | ✅ `id uuid PK` + `CREATE UNIQUE INDEX uq_hold_active … WHERE released_at IS NULL` |
| 2 | `target_pk text`(테이블-agnostic·트리거 캐스트) | ✅ `target_pk text`, 트리거 `OLD.id::text` |
| 3 | `released_by`·`release_reason` 신설(해제 감사) | ✅ 두 컬럼 신설 |
| 4 | `hold_ticket NOT NULL`(false-freeze 금지) | ✅ `hold_ticket text NOT NULL` |
| 5 | `guard_scope` 신설(트리거 확장 축·over-block 방지) | ✅ `guard_scope text NOT NULL DEFAULT 'phone_dummy_normalize'`, 트리거 `IN ('phone_dummy_normalize','all')` |
| 6 | 트리거 early-exit(LIKE 전이 먼저 → 매치 시에만 레지스트리 조회) | ✅ ① 전이 미매치 시 `RETURN NEW`(레지스트리 조회 없음), ② 매치 시에만 SELECT |
| 7 | 명료 EXCEPTION(hold_ticket·target_pk 포함) | ✅ `RAISE EXCEPTION … target_pk=% hold_ticket=%` + HINT(해제 SQL) |
| 8 | 회귀행렬 6종 evidence | ✅ 아래 dry-run 결과(ALL PASS 6/6) |
| 9 | 라이브 후 DA 가 backfill_sop §hold-registry 로 cross-CRM 승격 | ⏭ DA 후속 소유(라이브 확인 후 codify) — 본 티켓 범위 밖(인지·기록) |

추가 하드닝(dev 판단, DA 정합):
- 함수 **SECURITY DEFINER**(owner=postgres) — 비-service 컨텍스트에서도 레지스트리 조회 성립 → fail-OPEN 방지.
- 레지스트리 테이블 **RLS enable(정책 0=deny)** — anon/authenticated PostgREST 노출 차단(service_role/DEFINER 는 bypass).
- 트리거 `BEFORE UPDATE OF phone`(phone 변경 UPDATE 에서만 발화) — 추가 hot-path 최적화.

## 회귀행렬 6종 — dry-run 실행 evidence (mig_dryrun)
`node scripts/T-20260724-foot-HOLD-GUARD-APPLY_dryrun.mjs` (2026-07-24, prod rxlomoozakkjesdqjtvd, 무영속):
```
DRYRUN RESULT: case1(held→DUMMY expect BLOCK)=BLOCK✓ case2(free→DUMMY expect PASS)=PASS✓
  case3(held self_checkin real-phone expect PASS)=PASS✓ case4(held staff real-phone expect PASS)=PASS✓
  case5(released→DUMMY expect PASS)=PASS✓ case6(HARDEN non-hold expect PASS)=PASS✓
  verdict=ALL PASS (6/6 회귀행렬 통과)
POST-PROBE (무영속 재확인): {"trg_persisted":0,"table_persisted":false,"testrows_persisted":0}
```
→ **정상 corrective/normalize 경로 회귀 0**(case2·3·4·6 PASS) + **의도된 hold 차단**(case1 BLOCK) + **해제 라이프사이클 정상**(case5 PASS). 무영속(unwind) 확인.

무영속 프로토콜: 전체가 단일 DO 블록(단일 statement) → 블록 말미 RAISE 로 강제 unwind. up.sql 에 txn-control(COMMIT) 내장 없음 → sentinel-bypass hazard 미해당. POST-PROBE(별도 세션 read-only) 로 객체·데이터 미영속 재확인.

## 정상 corrective 경로 상호작용 검증 (회귀 가드)
- **self_checkin_with_reservation_link**: `writes_phone_dummy=false` → phone→DUMMY 전이 없음 → 트리거 매치 안 함(case3 PASS).
- **insert-mint write-path**: BEFORE INSERT 시점 mint → BEFORE UPDATE 트리거 미발화(트리거 이벤트=UPDATE only).
- **PHONE-NORMALIZE HARDEN(T-20260721)**: active-hold 행만 차단(의도=freeze-window 무결), 비-hold 무영향(case6 PASS) → correct-by-design.

## ledger 3자 대조 (mig_ledger_check) — pre-apply
```
file      = PRESENT (4파일)
ledger    = ABSENT ✓ (schema_migrations version=20260724120000 count=0)
prod-objs = ABSENT ✓ (table/fn/trg 전부 미존재)
```
→ 미적용 ADDITIVE 마이그의 정상 pre-apply 상태(3자 정합). supervisor DB-GATE 가 apply 후 post-apply 3자(file=ledger=prod 전부 PRESENT) 재대조 + `applied_at` evidence.

## 롤백 (mig_rollback)
`20260724120000_foot_data_correction_hold_registry_guard.rollback.sql` = `DROP TRIGGER` + `DROP FUNCTION` + `DROP TABLE`(uq_hold_active 동반). 순손실 0(테이블 자체가 신규). ⚠ 롤백 전 진행 중 active hold 없음 확인(freeze-window 보호 해제 방지).

---

## (b) ledger 편입 SOP (보강)
향후 masked-phone dummy-normalize corrective 는 **수동 직접 SQL 을 지양**하고 다음 경로로만 수행한다:
1. committed 마이그/스크립트(git ledger 접점) + SOP freeze(대상셋 고정·before-image 스냅샷).
2. 실행 전 hold-registry pre-check(아래 (a) 스니펫) 필수.
3. 수동 OOB SQL 이 불가피하면 hold-registry 를 먼저 조회하고 (a) 제외를 포함할 것 — 단 트리거(c)가 active-hold phone→DUMMY 를 DB 레벨에서 fail-closed 차단하므로 hold 행은 구조적으로 보호됨.
> 정직 caveat(DA): 트리거는 `session_replication_role='replica'`/`DISABLE TRIGGER` 로 우회 가능(defense-in-depth, 절대봉인 아님). 트리거 disable 은 이례 이벤트로 취급(향후 audit 훅 후보).
> cross-CRM 표준 승격은 라이브 후 DA 가 `data_correction_backfill_sop §hold-registry` 로 fold(판정1 소유).

## (a) predicate 제외 표준 스니펫 (보강 · 트리거와 동일 조건, 이중 방어)
```sql
UPDATE public.customers c
   SET phone = 'DUMMY-' || gen_random_uuid()
 WHERE <masked-phone predicate>   -- isPhoneMasked 동치
   AND NOT EXISTS (
     SELECT 1 FROM public.data_correction_hold_registry h
      WHERE h.target_table = 'customers'
        AND h.target_pk    = c.id::text
        AND h.clinic_id    = c.clinic_id
        AND h.guard_scope  IN ('phone_dummy_normalize', 'all')
        AND h.released_at  IS NULL
   );
```

## blocks 해소 (T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION)
- 본 가드 라이브(supervisor DB-GATE apply) + ROW1 을 seed.sql 로 active hold 등록 → ROW1 이 registry 에 등재된 채 파괴 op 재개 시에도 dummy-normalize 재-sweep 이 **DB 레벨 fail-closed 차단** → freeze-window 무결 보장.
- 가드 라이브 확인 후 planner 에 blocks 선행의존 해소 통지.
