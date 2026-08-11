# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Leg A-(b) + Leg B FRESH dry-run evidence (post-A-a-apply)

- **작성**: dev-foot, 2026-08-11
- **트리거**: planner INFO CONFIRM (MSG-20260811-164639-ll2h) — 잔여 2 leg 순차 GO. A-a apply 로 prod 상태 변동(customers 3 소멸) → **현행 prod 대상 No-Persistence dry-run 재생성**(stale A-a 前 스냅샷 금지) + 원장 3자 대조.
- **mig files commit**: `8fe73892` (3-leg authoring) — **신규 코드변경 0** (dry-run 재실행만, DDL 무변경).
- **repo HEAD 시점**: `785588ba`
- **canonical_repo**: obliv-foot-crm · **artifact_class**: db_only

## 1. 현행 prod No-Persistence dry-run 재실행 (둘 다 PASS)

### A-(b) Path-B 물리삭제 2행 — `20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row`
```
== DRY-RUN PASS == (Path-B scoped DISABLE→DELETE(fs 2)→ENABLE, 91 rows, tgenabled 무누출, 무영속)
stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
post-probe 17 _arch_testacct8_ab_*_20260811 전건 absent (CREATE 롤백)
post-probe customers 2행 잔존(DELETE 롤백) absent=true
post-probe form_submissions 2행 잔존(scoped purge 롤백) absent=true
post-probe trg_form_submissions_published_immutable tgenabled=O(무누출) absent=true
```

### Leg B 2차 is_test flag 2건 — `20260811060000_foot_testacct8_legB_istest_flag_2row`
```
== DRY-RUN PASS == (Leg B 2차 flag UPDATE 2건, id whitelist, 무영속·본계정 무접촉)
post-probe F-4427·F-4445 is_test 미영속(flag 롤백) absent=true
post-probe 박민석 본계정 F-4790 is_test=false 불변 absent=true
post-probe is_test=true 전체 = 3(1차분·미영속) absent=true
```

## 2. 원장 3자 대조 (schema_migrations ↔ 파일 ↔ 현행 prod)

| 항목 | 실측 | 판정 |
|------|------|------|
| schema_migrations `20260811050000`/`060000` | `[]` (미기록) | ✅ 미충돌 |
| ledger tip | `20260811120000` > 내 버전(050000/060000) | ⚠️ out-of-order(비충돌·비의존) — §note |
| prod customers is_test 컬럼 | 존재(01:08 Leg B 인프라 applied) | ✅ 파일선언 정합 |
| A-b live roots | F-4425(풋테스트3,draft,serial NULL) · F-4692(송지현2,voided,serial NULL) = 2행 | ✅ |
| A-b form_submissions | 2행 serial NULL(draft/voided) | ✅ |
| A-b fs FK children | form_submissions_audit_log 0 · self-ref(source_submission_id) 0 | ✅ FK-safe |
| Leg B targets | F-4427/F-4445 is_test=false(pre-apply) | ✅ |
| 박민석 본계정 F-4790 | is_test=false(leak-guard) | ✅ 무접촉 |
| is_test=true 전체 | {F-4574,F-4990,F-5113} n=3 (1차분) | ✅ |
| A-a 3행(F-4691/F-4703/F-4468) | count=0 (소멸 확인) | ✅ |

## 3. F-4427 leak-guard (Path-B)

- F-4427 = **printed·doc_serial_seq=74**(발번문서·의료법 §22/§40 보존) → hard-DELETE HARD REJECT.
- F-4427 customer 는 A-b DELETE root scope(`21a8…`/`d7fa…`) 밖 → Path-B 물리삭제 미포함 ✅.
- A-b up.sql leak-guard: serial NOT NULL / printed 혼입 시 ABORT (H3 in-txn).
- F-4427 처분 = Leg B is_test view-hide (본 fresh dry-run Leg B 대상).

## 4. §note — ledger out-of-order

내 두 마이그 버전(20260811**05**0000·**06**0000)은 8fe73892 authoring 시각 기준. 이후 타 티켓이 20260811070000/080000/120000 을 apply → 현 ledger tip=120000. 내 버전이 tip 보다 낮음(out-of-order).
- **비충돌**: name/version 둘 다 미기록(§2).
- **비의존**: A-b(독립 DELETE)·Leg B(독립 flag UPDATE) 는 070000+ 마이그와 데이터/스키마 의존 0.
- **apply 경로**: `supabase db push` 순차재생 아님 — db_apply_guard.sh 물리 GO-token 개별 apply + version 개별기록. out-of-order 기록 무해.
- supervisor 판단용 flag (비차단). 필요 시 renumber 재authoring 가능(별 turn).

## 5. apply 게이트 (미집행 — supervisor GO-token 前 prod DELETE/UPDATE 금지)

- **A-(b)**: CEO H6 sign-off GO 旣수신(MSG-20260811-122210-psik) → 잔여 = supervisor DDL-diff(ALTER..DISABLE/ENABLE)+Migration Dry-Run No-Persistence 재확인+**tgenabled 사후재확인(in-txn)**+물리 GO-token. GO-token 前 DISABLE/DELETE 선집행 금지(apply_before_go).
- **Leg B**: 잔여 = supervisor DB-GATE(freeze-set {F-4427,F-4445} + rows-affected=2 + silent 0-row 금지)+GO-token.
- 순서: **A-b → Leg B** (planner INFO 지정).
