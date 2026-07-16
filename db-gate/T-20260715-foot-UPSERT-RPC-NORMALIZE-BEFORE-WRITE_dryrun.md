# T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE — migration dry-run 증거 (No-Persistence)

> 러너: `scripts/T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE_dryrun.mjs` (Management API `/database/query`).
> **mutation 0 / persistence NONE.** DDL 유효성 = BEGIN…ROLLBACK(파일 BEGIN/COMMIT strip) 검증 후 무영속,
> 사후 introspection 으로 무영속 확증(`C_no_persistence_confirmed: true`).
> DA CONSULT-REPLY GO — decision **DA-20260716-FOOT-UPSERT-RPC-NORMALIZE-CANON** (MSG-20260716-233104-jc5c).
> 실행: dev-foot / 2026-07-16 KST. prod 무변경 — deploy 는 supervisor DDL-diff+behavior-diff 게이트 통과 후.

---

## 결론 요약

| 항목 | 결과 |
|---|---|
| normalize_phone SSOT 실재 | ✅ `provolatile=i`(IMMUTABLE) · `proisstrict=true`(STRICT) · `(p_phone text)` — 재사용 정합 |
| before-snapshot (3함수 INSERT phone) | 전부 RAW (`has_normalize_write=false`) — 정규화 미반영 확인 |
| 마이그 DDL parse+exec | ✅ OK (BEGIN…ROLLBACK) |
| post-probe 무영속 확증 | ✅ `C_no_persistence_confirmed: true` (3함수 여전히 RAW = prod 무변경) |
| behavior-diff (8벡터) | ✅ 아래 표 — DA canon 정확 일치 |
| mutation | **0** (persistence NONE) |

---

## behavior-diff (normalize_phone 8벡터 → 저장값 → customers_phone_e164_chk 통과 시뮬)

| label | raw 입력 | 저장값(normalize_phone) | CHECK 통과 | 판정 |
|---|---|---|---|---|
| kr_raw11 | `01012345678` | `+821012345678` | ✅ | **RC 해소** — batch#3 유효모바일(버킷1) → +82 변환 → 통과. 정당 국내환자 drop 0 |
| kr_hyphen | `010-1234-5678` | `+821012345678` | ✅ | 하이픈 제거+변환 |
| kr_e164 | `+821012345678` | `+821012345678` | ✅ | no-op passthrough |
| dummy | `DUMMY-abc123` | `DUMMY-abc123` | ✅ | ELSE passthrough → CHECK ACCEPT (Q2 carve-out) |
| placeholder | `+821000000000` | `+821000000000` | ✅ | 동행 placeholder passthrough → ACCEPT (Q2) |
| intl_e164 | `+15551234567` | `+15551234567` | ✅ | 국제 E.164 passthrough → ACCEPT (Q2) |
| intl_raw | `15551234567` | `15551234567` | ❌ REJECT | **의도** — 국제-raw(+없음) = Q2(a) 무조치. 현 self-checkin 외국인=email-only, inflow 0 |
| garbage_lt8 | `1234` | `1234` | ❌ REJECT | **의도** — write-path garbage fail-loud (Q3). NULL carve 안 함(customers.phone NOT NULL) |

→ 정당 국내환자(유효모바일)=**항상 CHECK 통과**. REJECT 대상 = genuine garbage + 국제-raw 뿐 (fail-close = feature).

---

## 변경 범위 (ADDITIVE · CREATE OR REPLACE x3 · 스키마 무변경)

- **[3함수 공통]** INSERT VALUES phone: RAW(`p_phone`/`NULLIF(p_phone,'')`) → `public.normalize_phone(NULLIF(p_phone,''))`.
  - STRICT landmine 회피: `NULLIF(p_phone,'')` 래핑 → 빈/NULL→NULL = 현행 NULLIF 동작 불변(동치 보존, Q1). 새 NOT NULL fail 0.
- **[base 만]** dedup 비교키(SELECT main + unique_violation handler)를 v2/v3 와 동일 canonical(`82…`)로 수렴.
  - ⚠ 필수 후속(신규 divergence 아님·convergence): base 기존 dedup 은 raw-digit 직접비교 → WRITE 정규화 시 자기 정규화-저장행 재체크인 dedup 실패 → **중복 customers 생성 회귀**. v2/v3 가 이미 쓰는(DA-blessed) canonical CASE 로 수렴하여 회귀 차단. v2/v3 dedup 은 이미 canonical 양측 → 무변경.
- **[Q4]** UPDATE(linked) 경로 phone 재저장 추가 안 함 — new-write(INSERT)-only. 기존 raw 행 소급정정은 T-20260713-BACKFILL-VALIDATE 소관.
- **[Q5]** created_by NULL 보정 fold 안 함 — 별도 planner TICKET-REQ.

## 배포순서 (planner 권고)
- write-path 정규화는 Step1(customers_phone_e164_chk VALIDATE) 전/동시 배포 권장 — 선배포 시 정당 호출자 CHECK-safe → Step1=순수 backstop(이중방어). Step1 순서 자체는 부모 human_pending(호출자 a폐기/b운영중) 종속.

## MIG-GATE 4필드
- mig_files: `20260716230000_foot_selfcheckin_upsert_writepath_phone_normalize.sql` (+ `.rollback.sql`)
- mig_dryrun: 본 문서 + `_dryrun.json` (No-Persistence, behavior-diff 8벡터 PASS)
- mig_ledger_check: schema_migrations↔파일↔prod 3자 대조 — 본 파일 신규(미적용), prod 무변경(post-probe RAW 확증). 적용은 supervisor deploy 시.
- mig_rollback: `20260716230000_..._normalize.rollback.sql` (3함수 가드-前 정의 verbatim 복원, 멱등).
