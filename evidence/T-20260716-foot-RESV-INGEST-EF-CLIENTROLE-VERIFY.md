# T-20260716-foot-RESV-INGEST-EF-CLIENTROLE-VERIFY — 수신 EF client role 실증

**티켓**: T-20260716-foot-RESV-INGEST-EF-CLIENTROLE-VERIFY (P2·조사·read-only·db_change=false)
**목적**: obliv-foot-crm 수신 EF `reservation-ingest-from-dopamine`가 `upsert_reservation_from_source`
호출 시 Supabase client role(service_role vs anon)을 in-repo 코드라인 근거로 확정 →
`upsert_reservation_from_source` anon REVOKE-eligibility 최종 판정근거 완성.
**parent**: T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP
**HEAD**: feat/T-20260714-foot-INSGRADE-RESETTLE

---

## AC-1 (R1) — 수신 EF client role = **service_role** (CONFIRMED, 추정 아님)

`supabase/functions/reservation-ingest-from-dopamine/index.ts`

client 생성부 (L295-298):
```ts
// ── Supabase service role client ──────────────────────────────────────────
const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;   // ← L297
const admin        = createClient(supabaseUrl, serviceKey);        // ← L298
```

RPC 호출부 (L494) — 위 `admin`(service_role) client로 직접 호출:
```ts
const { data: rpcRid, error: rpcErr } = await admin.rpc('upsert_reservation_from_source', rpcArgs);
```

**판정**: `upsert_reservation_from_source`의 유일한 production 호출부는 이 수신 EF이며,
호출 client `admin`은 `SUPABASE_SERVICE_ROLE_KEY`로 생성됨(anon 아님). RLS/GRANT를
service_role이 우회하므로 anon EXECUTE 권한 불요.

**dev-dopamine 정황 검증**: foot-reservation-push L51 'service_role_key 사용' → 수신측도
service_role일 것 → **in-repo로 검증됨(반증 아님)**. emit·ingest 양측 모두 service_role,
apikey/Authorization 미부착 secret-authed 체인(X-Callback-Secret, L191-196)과 정합.

---

## AC-2 (R2) — Zapier→foot RPC 직결 부재 (in-repo 근거)

1. `upsert_reservation_from_source`의 `.rpc(...)` 호출부 repo-wide grep 결과 —
   **production code 호출부는 수신 EF L494 단 1곳.** 나머지는 전부 테스트/검증 스크립트:
   - `tests/e2e/T-20260630-foot-TM-EDIT-CANCEL.spec.ts` L37 (service-role 테스트 harness)
   - `tests/e2e/T-20260630-foot-COMPANION-RESV-INSERT-FAIL.spec.ts` L77/114/143/165
   - `tests/e2e/T-20260512-foot-CONTRACT-ALIGN.spec.ts` L235 (service-role)
   - `tests/e2e/T-20260630-foot-FOOTRESV-MEMO-PUSH-DROP.spec.ts` L41
   - `scripts/T-20260630-FOOTRESV-CANCEL-RCA_verify.mjs` L21/27 (검증 스크립트)
   → EF 경유 없이 직접 호출하는 애플리케이션 write-path 부재.

2. `zapier|Zapier|ZAPIER` repo-wide grep = **0건.** in-repo에 Zapier webhook 핸들러·직결부 없음.

3. anon client가 이 RPC를 호출하는 경로 없음:
   - repo 내 `SUPABASE_ANON_KEY` createClient는 `receipt-ocr`(영수증 OCR, 무관),
     `dopamine-callback`(auth 검증용 anonClient), `nhis-lookup`(auth 검증용 anonClient)뿐.
   - 이들 중 `upsert_reservation_from_source`를 호출하는 곳 없음(grep 교차 확인).

**판정**: tm-flow상 예약 push는 전부 EF(`reservation-ingest-from-dopamine`) 매개.
in-repo 근거상 Zapier→foot RPC 직결 경로 부재.
※ 최종 positive-absence 확인 owner = ops/연동(Zapier 콘솔). dev-foot는 in-repo 근거만 제공.

---

## 종합 판정근거 (→ DA)

- **R1**: 수신 EF client role = **service_role** (L297-298 SERVICE_ROLE_KEY, L494 admin.rpc)
- **R2**: in-repo Zapier 직결 부재 (production 호출부 = EF 1곳, zapier 0건, anon 호출 0건)
- ⇒ `upsert_reservation_from_source`는 service_role 전용 invoke + 직접 anon 호출 경로 부재.
  Zapier 콘솔 positive-absence(ops 확인) 결합 시 **REVOKE anon EXECUTE 판정근거 완성.**

## 게이트/불변 준수
- 본 티켓 = 조사(read-only)만 수행. 권한(REVOKE/GRANT)·EF·연동 변경 **없음**.
- fail-safe: 판정 확정 전까지 `upsert_reservation_from_source` KEEP anon(현행) 유지.
- db_change=false·investigation_only → E2E/DDL-diff/대표게이트 불요.
