# T-20260717-foot-VAULT-SECRET-ROTATION-POSTEXPOSURE — internal_cron_secret rotation runbook + 완결성 판정

- 작성: dev-foot / 2026-08-10
- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- class: **prod vault mutation (apply-before-go)** — supervisor DB-gate GO-token 발행 후에만 prod apply
- db_change(스키마 DDL): **false** (secret 값 교체·env 재배선. CREATE/ALTER/DROP 無)
- 상태: **PREP ONLY — 미집행.** 본 문서는 supervisor DB-gate + DA §4 cron 협의용 runbook. prod 변경 0건.

---

## 0. 대상 & 위협 모델

- foot vault `internal_cron_secret` (2026-05-27 생성 — `20260527100000_messaging_s2_ops_data.sql` 컨텍스트).
- 노출창 존재 → **presumed-compromised**, ROTATE **MEDIUM**.
- anon 봉합 착지(2026-07-17 sealed) 후 = 재-exfil 창 닫힘 → rotation 안전 타이밍.
- solapi HIGH leg(사람 window 조율)와 **분리** — 본 leg는 외부콘솔 불요·SMS cutover 무관하므로 불대기 선행.

---

## 1. Rotation surface (완전성 census) — ★ producer + validator 4포인트

`internal_cron_secret` 값은 **producer(DB)** 가 각인 → **validator(EF env)** 가 대조하는 2-sided 공유 시크릿.
아래 **4포인트 전량**을 동일 신값으로 교체해야 한다. 하나라도 누락 시 해당 cron leg 전량 401.

### Producer (DB, foot 프로젝트)
| # | 위치 | 참조 방식 | 근거 |
|---|------|-----------|------|
| P1 | `vault.decrypted_secrets` / `vault.secrets` name=`internal_cron_secret` | `get_vault_secret('internal_cron_secret')` · `SELECT decrypted_secret … WHERE name='internal_cron_secret'` | `20260527100000_messaging_s2_ops_data.sql:203,288` 외 |
| P2 | GUC `app.cron_secret` (설정 시) | `COALESCE(current_setting('app.cron_secret',TRUE), get_vault_secret('internal_cron_secret'))` | 동 migration:286-289 |

> P2는 COALESCE 1순위 override. GUC가 role/db 레벨에 set 되어 있으면 vault(P1) 갱신이 무시된다 → **GUC 실재 여부 introspect 선결**(있으면 GUC도 교체, 없으면 vault-only).

### Validator (EF env, foot 프로젝트) — ★ env 이름 2종 (불일치 실측)
| # | env 이름 | 소비 EF | 근거 |
|---|----------|---------|------|
| V1 | `INTERNAL_CRON_SECRET` | send-notification · dopamine-callback-dispatch · redpay-planb-match · redpay-reconcile · redpay-unreg-digest (5) | 각 index.ts `Deno.env.get("INTERNAL_CRON_SECRET")` |
| V2 | `CRON_SECRET` | attendance-sync · closing-confirmed-publisher (2) | 각 index.ts `Deno.env.get("CRON_SECRET")` · closing-confirmed-publisher 주석 "CRON_SECRET(=internal_cron_secret)" |

> **★ 완결성 catch (intra-fork):** validator env 이름이 **2종**이다. V1만 교체하고 V2를 누락하면 attendance-sync · closing-confirmed-publisher 두 cron이 신 secret 대조 실패로 전량 401 → 근태 sync · 마감 publish 중단. **V1·V2 동시 교체 필수.**
> 7개 EF 모두 `verify_jwt=false`(config.toml) → 게이트웨이 JWT 검사 off, 인증은 EF 내부 헤더 대조에 100% 의존 → 시크릿 교체가 유일 인증축.

---

## 2. Rotation 절차 (dual-accept 무중단 — 권장 A안)

값 대조가 `got === SINGLE_ENV` (단일 env 등가비교)이므로, 무중단 dual-accept는 **EF 코드에서 old∨new 동시 수용**이 필요.

**A안 (dual-accept, 무중단 권장):**
1. **구키 유지** — 현행 4포인트 값 그대로.
2. **EF 코드 delta 배포** — validator를 `got===SECRET || got===SECRET_NEXT` 로 확장 (`INTERNAL_CRON_SECRET_NEXT` / `CRON_SECRET_NEXT` env 추가). old·new 동시 수용. → supervisor code-gate + 배포.
3. **신 secret 발급** — `encode(gen_random_bytes(32),'hex')` (repo canonical 패턴, `20260802180000_attendance_qr_port.sql:246` 준용). **fork별 독립 생성**(공유 금지).
4. **재배선** — P1 vault 값 = 신값, (P2 GUC 있으면) 신값, V1·V2 `*_NEXT` env = 신값.
5. **검증** — 7 EF cron 전량 신값으로 200. (아래 §4 검증표)
6. **구키 폐기** — V1·V2 primary env = 신값으로 승격, `*_NEXT` 제거, EF 코드 dual-accept 원복(단일 대조), 구값 폐기. 폐기 시각 기록.

**B안 (atomic cutover, 코드무변경 폴백):** 4포인트 동시 교체 + 짧은 401 gap 수용. cron leg 대부분 retry/DLQ 보유하나 gap 중 호출은 거부 → MEDIUM에서도 A안 권장. B안 채택 시 DA §4 cron + supervisor 명시 승인 필요.

> A안 EF 코드 delta는 **로직 변경(별도 code-gate)** — 본 runbook 범위 밖 별 커밋. db_change=false 유지(EF env·vault 값 교체는 스키마 DDL 아님).

---

## 3. ★ 게이트 (엄수)

- prod vault mutation = **supervisor DB-gate 경유**. **GO-token 발행 전 §2 step 3~6 prod 선집행 금지** (apply-before-go 클래스).
- DA §4 cron 실행 협의 (cron 재배선·검증 창).
- prod 변경 evidence 필수: 재발급 로그(값 미기재, hash만) · V1·V2 env 재배선 확인 · cron 재검증 200 · 구키 폐기 시각.
- E2E: FE 무변경 = db_only 면제 (`e2e_spec_exempt_reason: db_only-no-FE-surface`).

---

## 4. 검증표 (재배선 후, GO 하에서만 실행)

| leg | 호출 트리거 | 기대 |
|-----|-------------|------|
| send-notification | pg_cron D-1/morning/retry | 200, 발송 재개 |
| redpay-reconcile / planb-match / unreg-digest | 각 cron | 200 |
| dopamine-callback-dispatch | outbox worker | 200, pending→sent |
| attendance-sync (V2) | attendance cron | 200 ← V2 누락 시 여기서 401 검출 |
| closing-confirmed-publisher (V2) | 마감 publish | 200 ← V2 누락 시 여기서 401 검출 |

---

## 5. ★ Cross-fork 완결성 판정 (scalp / women / body 공유 여부)

**질문:** `internal_cron_secret` 값이 fork 간 동일값 상속인가? 동일이면 그 fork도 compromised → rotation 대상.

**foot-side 증거로 도달한 판정: INCONCLUSIVE (from foot alone) — 확인 leg 필요.**

근거:
1. 값 INSERT는 **out-of-band 수동 psql** ("vault INSERT는 별도 psql 직접 실행", migration:6) → **git에 값 없음**. foot repo 어디에도 리터럴 부재 → foot 단독으로 타 fork 공유 여부 판정 불가.
2. foot→scalp/women, body 는 하드포크. 포크 시 vault seed 방식(① dump/restore = 값 승계 / ② 각 fork `gen_random_bytes` 신규 = 독립)에 따라 공유 여부가 갈림. 수동 리터럴 재사용 시 **동일값 상속 REAL RISK** (← 티켓이 지목한 위험).
3. 도메인 격리 + 재-exfil 방지상, dev-foot이 타 fork prod vault를 직접 read 불가·부적절.

**권고 확인 leg (planner 스핀):**
- 각 fork dev(dev-scalp / dev-women / dev-body)가 **자기 DB에서** `SELECT encode(digest(decrypted_secret,'sha256'),'hex') FROM vault.decrypted_secrets WHERE name IN ('internal_cron_secret')` 실행(각자 supervisor read-gate 하) → **plaintext 아닌 hash만** 회신.
- foot hash 와 대조. **hash 일치 = 공유값 = 그 fork도 presumed-compromised → 해당 fork rotation leg 스핀.** 불일치 = 독립 → 무대상.
- ⚠️ plaintext 를 채널에 싣지 말 것(재노출). hash-only 비교로 충분.

**본 task 산출 회신 요지:** foot rotation runbook 준비 완료(§1~4, 미집행) + cross-fork = INCONCLUSIVE → hash-대조 leg 필요. solapi leg 별도(사람 window).

---

## 6. Cross-fork hash-대조 결과 (body leg — 2026-08-10 해소)

dev-body FOLLOWUP(MSG-20260810-080647-wsf3, body ticket `T-20260720-body-VAULT-SECRET-ROTATION-POSTEXPOSURE`)로 §5 확인 leg 실행. **hash-only 교환**(plaintext 미교환, 도메인 격리 유지).

| fork | digest (sha256 hex) | 비고 |
|------|---------------------|------|
| foot | `bec0aa00595651a51aff3002cca82665d14e54dd311ace171a695d1641eaa728` | in-DB `encode(digest(decrypted_secret,'sha256'),'hex')` · octet_length=64 · 후행 공백/개행 없음 · digest_raw==digest_trimmed |
| body | `622078d418c65e613ecc0e12b7934f852ef9e96c62c7bb7d2afb552507426362` | body 회신값 |

- **방법 등가성:** foot in-DB `digest()` = body `printf '%s' '<value>' | shasum -a 256`(개행 미포함)와 byte-equivalent. 후행 공백 없음(digest_raw==digest_trimmed) 확인 → 대조 유효.
- **판정: MISMATCH → foot ≠ body 값. foot 은 body 노출과 독립.** body compromise 는 foot 로 전파되지 않음 → body rotation 격리 완결(foot 무영향). foot 은 body-공유 compromised 대상 아님.
- **foot 자체 rotation 은 별 track:** foot-고유 노출창(anon exfil, 2026-07-17 봉합)에 의한 presumed-compromised 는 §0~4 그대로 유효(PREP-ONLY 미집행). body 값 공유 아님 → 신값은 §2 A안대로 fork별 독립 생성.
- 회신: `mq send --to dev-body` MSG-20260810-085832-davr. 본 대조 = read-only hash 산출, **foot prod vault mutation 0건**.
- **잔여 fork(scalp/women):** 동일 hash-대조 leg 미실행(별도 planner 스핀 시 foot digest 상단 표값 재사용).
