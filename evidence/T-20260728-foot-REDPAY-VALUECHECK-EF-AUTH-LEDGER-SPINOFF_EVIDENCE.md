# T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF — EF-side 잔여 caveat 3항목 실증거

- 발행: planner MSG-20260728-233640-n8oa (supervisor FIX-REQUEST §3 별건 spinoff)
- 성격: **db_change=false · no-DDL · read-only · EF-side only**. E2E ef_only 면제 / 대표게이트 면제(autonomy §3.1).
- 부모: T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK (commit `a9904286`, deployed/Green — poller↔watchdog NO_ENV_SHADOW 완결). 본 건은 그와 직교한 EF-side 3건만.
- 대상 코드: `supabase/functions/redpay-webhook/index.ts` 의 `whitelistFingerprintEf()` + `GET ?introspect=whitelist` 라우트 (a9904286 에서 +50줄 추가, **아직 공개 미배포**).

---

## AC-1 (a) ★핵심 — introspection GET 라우트 auth 게이트 실증거

### 검증 방법 (fail-safe 준수)
공개 `functions deploy` **전에** 실제 EF 핸들러(`index.ts`)를 **localhost 전용**으로 기동(`deno run`, 0.0.0.0:8000, 공개 노출 아님)하고 curl 로 auth 게이트를 실증. 배포는 하지 않음 → fail-safe("auth 게이트 실증거 확인 前 공개 배포 금지") 위반 0.

harness: 실 핸들러를 throwaway 더미 service_role 리터럴로 기동(운영 키 무관, secret 스캐너용 redact). T3 의 `Authorization: Bearer <same literal>` 도 동일 더미.

### 결과 (실 curl, localhost:8000/redpay-webhook)

| # | 요청 | 기대 | 실측 HTTP | 실측 body | 판정 |
|---|------|------|-----------|-----------|------|
| T1 | `GET ?introspect=whitelist` **auth 없음** | 401 | **401** | `{"ok":false,"error":"unauthorized_introspection"}` | ✅ PASS |
| T2 | `GET ?introspect=whitelist` **틀린 Bearer** | 401 | **401** | `{"ok":false,"error":"unauthorized_introspection"}` | ✅ PASS |
| T3 | `GET ?introspect=whitelist` **정 service_role Bearer** | 200+fingerprint | **200** | fingerprint(merchant27) 반환 | ✅ PASS |
| T4 | `GET` (introspect 파라미터 없음) | 405 | **405** | `{"ok":false,"error":"method_not_allowed"}` | ✅ PASS |

→ **auth 게이트 확립**: service_role bearer 정확일치 시에만 200. 미인증/오인증 = 401. 상수시간 아님이나 단순 문자열 동등비교(bearer !== SR_KEY)로 whitelist 유출 경로 없음.

### T3 authed 응답 fingerprint (핵심 필드)
```
subject           : webhook-ef
domain            : foot
tid_source        : n/a           ← 웹훅 EF 는 TID 미보유(정적 merchant 모듈만 read)
tid_count         : 0
merchant_source   : static-module(FOOT_MERCHANT_SET)
merchant_count    : 27
merchant_sha256   : cc86c311bda6e4b0159249ac95036e020a75c6f0e2484716b98fa2490dbd5601
canon_spec        : trim→drop-empty→dedup→sort(codepoint asc)→join('\n')→sha256-hex
```

### 결제 POST 경로 격리 (T6)
- `POST ?introspect=whitelist` (introspect 쿼리 실어도) → **payment 브랜치**로 라우팅, `401 invalid_signature` (introspection fingerprint 반환 아님).
- 코드 구조: `if (req.method === "GET") { …introspect… return }` 가 POST 결제 로직(서명검증·적재)보다 **위 early-return**. GET introspect 는 DB·supabase client 미접촉(no-DB·no-mutation).
- **양방향 격리 확립**: introspect 경로는 결제/DB 미도달, 결제 경로는 fingerprint 미반환.

### cross-tenant foot-scope 무붕괴 (T5)
- authed 응답 `merchant_sorted` 27개 = **전부 foot merchant** (1777285xxx VAN8 / 1777288xxx 유선 / 1777289xxx).
- body(도수) merchant 대역 `1777274xxx·1777275xxx·1777276xxx` 정규식 매칭 = **0건 (leak=[])**.
- 구조적 근거: `whitelistFingerprintEf()` 는 `FOOT_MERCHANT_SET` **단일 정적 모듈만** 읽음. `BODY_MERCHANT_SET` 을 애초에 import·참조하지 않음 → 타 tenant TID 노출 경로 부재(설계상 불가). `filterToFootScope`/`centerForMerchant` 이 별개로 존재하나 EF introspection 은 foot set 만 열람.

**AC-1 판정: ✅ auth 게이트·결제격리·foot-scope 무붕괴 모두 실증. 미인증 공개노출·cross-tenant 실노출 = 발견 0 (P0 승격 트리거 미해당).**

---

## AC-2 (b) — redpay-webhook EF deploy evidence + 배포 결정

### 현 배포본 introspection 반영여부 (read-only 라이브 프로브, 배포 아님)
LIVE `https://rxlomoozakkjesdqjtvd.supabase.co/functions/v1/redpay-webhook`

| 요청 | 실측 | 해석 |
|------|------|------|
| `GET ?introspect=whitelist` (auth 없음) | **405 `method_not_allowed`** | introspection **미반영**(구 빌드). 반영본이면 `401 unauthorized_introspection` 여야 함 |
| `GET` (plain) | **405 `method_not_allowed`** | 동일 — 구 빌드 확정 |

→ 현 관측 = **method_not_allowed** (ticket 관측과 정합). introspection GET 라우트는 **현재 prod 미배포** 상태.

### 배포 경로
`supabase functions deploy redpay-webhook --project-ref rxlomoozakkjesdqjtvd` (verify_jwt off — 웹훅은 JWT 미동반, 라이브 405가 platform 401 아닌 함수-바디 405인 점이 verify_jwt off 방증. ∴ introspection 유일 auth = 함수내 service_role bearer 체크 = AC-1 실증분).

### 배포 결정: **HOLD (미배포 유지)**
- fail-safe 조건("auth 게이트 실증거 확인 前 공개 배포 금지")은 AC-1 로 **충족**됨 → 배포는 기술적으로 unblock 가능.
- 그러나 **미배포 유지**를 택함. 근거:
  1. **poller↔watchdog 로 이미 충분** — 부모 VALUECHECK(deployed/Green)에서 poller·watchdog 런타임 merchant fingerprint 완전일치(NO_ENV_SHADOW). EF introspection 은 **잉여 3번째 확인 채널**이지 결론의 load-bearing 요소 아님.
  2. EF 는 정적 `FOOT_MERCHANT_SET`(전 빌드 공통 코드경로)만 읽음 → 배포해도 새 정보 없음. 그 merchant fingerprint 가 poller/watchdog 와 동일함은 **본 로컬 실행에서 이미 실증**(§3방 정합 아래).
  3. 공개 introspection 라우트 신설은 supervisor code-gate 심사 대상(auth·scope·read-only) → GO 전 prod 노출 최소화가 안전.
- **deploy 결정은 supervisor code-gate 로 이관.** dev-foot 는 배포하지 않음. GO 시에도 배포 없이 종결 가능(poller↔watchdog 충분).

**AC-2 판정: ✅ 현 미반영(405) 실증 + 배포경로 명시 + HOLD(미배포 유지, poller↔watchdog 충분) 결정.**

---

## AC-3 (c) — commit / 원장 3자 정합 (Ledger Reconciliation 준용)

db_change=false → `schema_migrations` 무접점. commit-ledger 3자만 대조.

| 원장 | 대조 | 결과 |
|------|------|------|
| L1 git (origin/main 실재) | `a9904286` ⊆ origin/main ? | ✅ **YES** (merge-base --is-ancestor). origin/main HEAD(`2e2f9f2b`) 기준 a9904286 = 16 commit 이전. stack `a9904286 ←…← 745a6c7f ←…← 2e2f9f2b(HEAD)` (a9904286 = rev #16, 745a6c7f = rev #11; 관측 "745a6c7f←…←a9904286" = 최신→과거 표기와 정합) |
| L2 ticket ledger | 부모 VALUECHECK status | deployed/Green (MQ body 명시; deploy unit = macstudio launchd poller + origin/main 병합) |
| L3 schema_migrations | a9904286 가 migration 파일 접촉? | ✅ **0건** — a9904286 변경 = `scripts/`·`supabase/functions/`·`tickets/`·`evidence/` 만. `migrations/` 무접촉 → db_change=false 정합, schema_migrations 무접점 |

**AC-3 판정: ✅ a9904286 origin/main 실재 확정 → VALUECHECK deployed status 정합. db_change=false 원장 무접점 정합.**

---

## 부록 — 3방 런타임 merchant fingerprint 정합 (bonus)

| 주체 | merchant_count | merchant_sha256 | 출처 |
|------|----------------|-----------------|------|
| webhook-EF (본 로컬 실행) | 27 | `cc86c311bda6e4b0159249ac95036e020a75c6f0e2484716b98fa2490dbd5601` | T3 authed 응답 |
| poller (부모 VALUECHECK) | 27 | `cc86c311…5601` | a9904286 evidence ac2ac3.json |
| watchdog (부모 VALUECHECK) | 27 | `cc86c311…5601` | a9904286 evidence ac2ac3.json |

→ **EF == poller == watchdog** merchant 지문 완전일치. env-shadow(빌드/env 간 허용목록 불일치) 위험 = EF 축에서도 **0** 재확인.

---

## 게이트 핸드오프
- dev-foot 3건 evidence(AC-1/2/3) 산출 완료 → **supervisor code-gate** (auth 게이트·foot-scope·read-only 리뷰).
- 대표게이트 면제(autonomy §3.1: db_change=false + no-DDL + read-only). E2E ef_only 면제.
- ★AC-1 미인증 공개노출·cross-tenant 실노출 판명 = **없음** → P0 승격 미해당.
