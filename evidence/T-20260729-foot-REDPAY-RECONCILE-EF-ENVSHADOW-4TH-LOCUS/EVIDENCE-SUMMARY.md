# T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS — Step2 deliverable evidence

**성격**: EF-only (backend). db_change=false · no-DDL · no-data-mutation · additive. 2026-07-29 KST.
**스펙**: DA CONSULT-REPLY MSG-20260729-042150-ko2t GO — 순차병행 2축(①FIX primary + ②DETECT sensor), 한 배포단위.

---

## ①FIX — reconcile EF(D) TID 허용목록 registry-canonical 이관 (primary·must-do)

**진원**: D(redpay-reconcile EF)가 `REDPAY_TID_WHITELIST` 를 **env 단독 read** → 신규 풋 단말 TID 가
stale env(07-20 스냅샷 digest f9dc25cc)에 누락되면 `runMatcher` 의 Tier1/2 자동매칭(matcher.ts L296/L325
`tidWhitelist.has(raw.tid)`)을 skip → Tier3/tier4_manual 강등 + spurious missing_in_crm/match_failed.

**FIX**: poller(A, REGUNION-FIX)와 **동일 union-source** 로 정렬.
- canonical = `redpay_terminal_registry(domain='foot', active)` 의 `tid ∪ unnest(superseded_tids)`.
- env(`REDPAY_TID_WHITELIST`) = **override-only**(union 가산, registry 를 shadow 하지 않음).
- registry 미가용(DB 오류/미seed) → env 폴백(fail-safe, 매칭 완전정지 회피).
- 소비지점 **양 경로** 커버:
  - `runMatcher()` (match_only 경로, index.ts) — L586 env-Set build → `resolveTidWhitelist()` 로 교체.
  - `runPoller()` (incremental/daily_full cron 경로) — L371 env-Set build → `resolveTidWhitelist()` 로 교체
    (supervisor 실측 REDPAY_DRY_RUN=false ⇒ runPoller 도 env TID 실소비 → 양 경로 커버 필수).

**불변식**: no-DDL(registry 旣배포·SELECT only) · admit/scope 무접촉(raw ingest=poller A 책임) ·
매출 금액 불변(reconciled 스탬프 대상만 registry 로 확대) · merchant 축 무변경(정적 FOOT_MERCHANT_SET).

**범위 밖(fast-follow 별티켓)**: matcher merchant-keyed(TID-agnostic) 리팩터. 이번엔 registry-canonical union 이관까지만.

### AC-2 before/after 매칭 동작 앵커 → `ac2-before-after-anchor.txt`
supervisor 정식 CONSULT-REPLY(MSG-20260729-042504-21c5) 부가발견 folded (planner INFO MSG-20260729-043220-p13s).
- **divergence 실재**: D env=07-20T08:05Z 스냅샷(digest f9dc25cc, 26 TID·479xxx 세대) vs poller(A) UNSET→registry live union → D 가 07-20 이후 재프로비저닝분을 못 봄.
- **staleness delta 12 TID**(env 부재·registry 존재): 0723 535xxx(535845/535843/535842/535837/535835/535797) + 0724 538xxx(538241/538237/538231/538236) + 0728 538xxx(538239/538246).
- **대표례 289006 신 TID 1047538239**(10건/₩11.39M): BEFORE(env-only `has()`=false → Tier1/2 skip → Tier3/manual 강등 + spurious `missing_in_crm`) → AFTER(registry∪env `has()`=true → Tier1/2 자동매칭 + reconciled 스탬프/log write). matcher.ts L298/L325 `tidWhitelist.has(raw.tid)` 성립조건 기준.

---

## ②DETECT — 4주체 VALUECHECK fold (회귀센서)

- **introspect 라우트**: `GET ?introspect=whitelist` + `Authorization: Bearer <SERVICE_ROLE_KEY>`.
  결제/매칭 POST 경로와 완전 격리(top early-return). read-only · no-DB-write · PHI 무접촉.
- **지문 계약**: `scripts/lib/redpay_wl_fingerprint.mjs` CANON_SPEC 미러(webhook EF C 와 동일):
  `trim→drop-empty→dedup→sort(codepoint asc)→join('\n')→sha256-hex`. merchant=정적 FOOT_MERCHANT_SET,
  TID=실 로드값(registry∪env, ①FIX 경유).
- **valuecheck fold**: `scripts/redpay_envshadow_valuecheck.mjs` 에 reconcile-EF(D)를 4번째 peer 로 편입 →
  poller(A)↔watchdog(B)↔webhook-EF(C)↔reconcile-EF(D) 4-way SHA256 대조.
  TID fold=TID 로드 주체(A·B·D)만, merchant fold=전 주체(A·B·C·D).
- **⚠ A11(feed↔registry coverage)과 별개 축** — 4-way fold 의 집은 VALUECHECK(런타임 실 로드값 SHA256 합의).

---

## 게이트 증거

### auth fail-closed (VALUECHECK-EF-AUTH-LEDGER-SPINOFF 계승) → `auth-failclosed.txt`
로컬 Deno 기동 실측(SERVICE_ROLE_KEY=test-svc-key-abc123):

| CASE | 요청 | 결과 |
|------|------|------|
| 1 | 인증 헤더 없음 | **HTTP 401** `unauthorized_introspection` ✅ |
| 2 | 잘못된 Bearer | **HTTP 401** `unauthorized_introspection` ✅ |
| 3 | 올바른 Bearer | **HTTP 200** + fingerprint(subject=reconcile-ef) ✅ |
| 4 | GET 비-introspect 경로 | **HTTP 405** method_not_allowed ✅ |

CASE 3 fingerprint: tid_source=`env(fallback:registry-unavailable)`(로컬 registry 미접속 → 폴백 경로 실증),
tid_count=3, merchant_count=27, canon_spec 계약 준수.

### SHA256 canonicalization parity → `sha256-parity.txt`
reconcile-EF(crypto.subtle) 실측 hash == 공유 lib(node:crypto `whitelistFingerprint`) hash.
입력 `["1047538231","1047538236","1047479255"]` → 양측 모두
`9f5be4ac6104d01ce00bcce2562f3343385467f87f052c3e565cc0bcbdd492a5`.
⇒ **D↔A↔B↔C hash-compatible** (4-way fold 유효성 전제 충족).

### 4-way fold 센서 self-test → `4way-fold-selftest.txt`
| CASE | 시나리오 | 결과 |
|------|----------|------|
| A | 4주체 정합(D registry-union) | TID 합의 ✅, D outlier 아님 |
| B | D 만 stale TID(env-shadow) | TID 불합의 + **D outlier 감지** ✅ (센서 발화) |
| C | D 미배포(지문 미확보) | 3주체로 축소, graceful ✅ |

exit code 확장: 0=합의 / 3=env-shadow(안전) / 4=매출위험 / **5=reconcile-EF(D) fold 이탈**.

---

## 배포 후 확정 대상 (supervisor)
- prod 4-way live fold: `node scripts/redpay_envshadow_valuecheck.mjs --ef --json out.json`
  (macstudio, SUPABASE_URL/SERVICE_ROLE_KEY/REDPAY_RECONCILE_URL 배선) → D 편입 후 TID 4-way 합의 확인.
- before/after 앵커: D env=07-20 스냅샷(f9dc25cc) → FIX 후 registry live union 으로 수렴(A와 동일).
