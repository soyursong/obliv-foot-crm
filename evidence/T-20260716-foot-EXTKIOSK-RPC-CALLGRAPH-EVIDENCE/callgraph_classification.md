# T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE — 외부 셀프체크인 앱 .rpc() 콜그래프 분류

- **ticket**: T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE (P2·조사·db_change=false)
- **parent**: T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP · Batch2 전제 증거
- **DA req**: MSG-20260716-171526-nmir (TICKET-REQ #1)
- **작성**: dev-foot / 2026-07-16
- **성격**: 조사 전용. 권한 변경(REVOKE/GRANT)·마이그레이션 없음. 본 문서는 DA 재-CONSULT 판정을 위한 evidence.

---

## 0. 방법 (evidence source)

| source | 값 |
|--------|-----|
| 외부 키오스크 repo | `github.com/soyursong/foot-checkin` (local read-only clone) |
| repo HEAD | `155753f` — feat(checkin): T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH (**2026-07-15**) |
| 배포 URL | foot-checkin.pages.dev (anon key 클라이언트) |
| grep 대상 | 전 소스(`src/**/*.tsx`), tests, tests-live, scripts (node_modules/dist 제외) |
| 콜그래프 정의 | **top-level** = 외부 anon 클라이언트가 `anonClient.rpc('<fn>', …)` 로 **직접** 호출. **nested-only** = 직접호출 0 & 다른 함수 body 내부에서만 호출(정의자=postgres 컨텍스트). |
| DB-side 보강 | obliv-foot-crm `supabase/migrations/**` 정의·내부호출 grep (프로드 pg_proc 아님 — §5 한계 참조) |

> ⚠ **T-20260710 allowlist 대비 신선도**: 선행 마이그 `20260710223000_secdef_anon_execute_revoke_allowlist.sql` 의 화이트리스트는 키오스크 **HEAD 2026-07-10** grep 기반. 본 조사는 **HEAD 2026-07-15** 기준 → 그 사이 신규 top-level 호출 1건(`fn_selfcheckin_verify_reservation`, §4) 발견.

---

## 1. 외부 키오스크 top-level `.rpc()` 콜그래프 (전수, HEAD 155753f)

`src/pages/SelfCheckIn.tsx` 내 `anonClient.rpc(...)` 전수 9건:

| # | line | 함수 | Batch2 17-scope? |
|---|------|------|------------------|
| 1 | 1232 | `fn_selfcheckin_reservation_banner` | ✅ in-17 |
| 2 | 1403 | `fn_selfcheckin_today_reservations` | ✅ in-17 |
| 3 | 1493 | `fn_selfcheckin_verify_reservation` | ⚠ **NOT in-17** (§4) |
| 4 | 1894 | `fn_selfcheckin_dup_guard` | ✅ in-17 |
| 5 | 2081 | `self_checkin_with_reservation_link` | ✅ in-17 |
| 6 | 2126 | `next_queue_number` | out-17 (Batch1 KEEP-32, flow-adj) |
| 7 | 2191 | `fn_selfcheckin_update_personal_info` | ✅ in-17 |
| 8 | 2229 | `fn_selfcheckin_rrn_match` | ✅ in-17 |
| 9 | 2249 | `fn_selfcheckin_create_health_q_token` | ✅ in-17 |

**obliv-foot-crm 자체 src** 의 anon `.rpc('self_checkin_*'|'fn_selfcheckin_*')` = **0건** → 17함수는 외부 키오스크 전유(in-repo anon 페이지 미사용). 스태프 화면은 authenticated 클라이언트로 별도 경로.

---

## 2. Batch2 17함수 분류표 (핵심 산출)

Batch2 scope = `self_checkin_*` 3 + `fn_selfcheckin_*` 14 = 17 (parent Batch1 마이그 KEEP-list 발췌).

### 2-A. TOP-LEVEL 직접호출 → **KEEP** (anon EXECUTE 유지 필수) — 7

| # | 함수 | 근거(kiosk line) |
|---|------|------------------|
| 1 | `self_checkin_with_reservation_link` | L2081 |
| 2 | `fn_selfcheckin_reservation_banner` | L1232 |
| 3 | `fn_selfcheckin_today_reservations` | L1403 |
| 4 | `fn_selfcheckin_dup_guard` | L1894 |
| 5 | `fn_selfcheckin_update_personal_info` | L2191 |
| 6 | `fn_selfcheckin_rrn_match` | L2229 |
| 7 | `fn_selfcheckin_create_health_q_token` | L2249 |

> 7개 모두 T-20260710 allowlist(14)에도 이미 포함 → 신선도 일치, 회귀 없음.

### 2-B. NON-top-level → **REVOKE-eligible** (anon 직접호출 0) — 10

| # | 함수 | migration def | nested 호출(migration, non-comment) | 판정 근거 |
|---|------|:---:|:---:|-----------|
| 1 | `self_checkin_create` | 있음 | 0 | 키오스크 직접호출 0. 오케스트레이터도 미호출 → orphan/legacy |
| 2 | `self_checkin_lookup` | **없음**⚠ | 0 | 키오스크 직접호출 0. migration 정의 부재(프로드 OOB) → §5 프로드 introspect 선행 |
| 3 | `fn_selfcheckin_create_check_in` | 있음 | 0 | 상동 (create_check_in — kiosk가 `next_queue_number`만 선-계산, 본체 미호출) |
| 4 | `fn_selfcheckin_existing_checkin_today` | 있음 | 0 | orphan/legacy |
| 5 | `fn_selfcheckin_find_customer` | 있음 | 0 | orphan/legacy |
| 6 | `fn_selfcheckin_linked_checkin` | 있음 | 0 | orphan/legacy |
| 7 | `fn_selfcheckin_match_reservation` | 있음 | 0 | orphan/legacy |
| 8 | `fn_selfcheckin_upsert_customer` | 있음 | 0 | orphan/legacy |
| 9 | `fn_selfcheckin_upsert_customer_resolve_v2` | 있음 | 0 | orphan/legacy |
| 10 | `fn_selfcheckin_upsert_customer_resolve_v3` | 있음 | 0 | orphan/legacy |

**중요**: 현 write-path 오케스트레이터 `self_checkin_with_reservation_link`(SECURITY **DEFINER**) / `self_checkin_create`(SECURITY **DEFINER**) 은 body 내부를 **inline SQL(직접 INSERT/SELECT on tables)** 로 처리 → 위 10개 helper 를 **nested 호출하지 않음**. 즉 이 10개는 "definer-체인에 숨은 nested-only" 가 아니라 **현 콜그래프에서 orphan(사장) helper** 로 보인다. 어느 쪽이든 anon 직접-노출 필요성 없음 = REVOKE-eligible.

### 2-C. anon EXECUTE 검사와 SECURITY DEFINER 관계 (안전성 논거)

- top-level KEEP 7개가 helper 를 내부 호출하더라도, 호출자가 **SECURITY DEFINER**(정의자=postgres)면 nested 함수의 EXECUTE 는 postgres 기준 검사 → **anon EXECUTE 불요**. (선행 T-20260710 마이그 lines 41-43·51 과 동일 논거.)
- 확인: 두 write 오케스트레이터 모두 `SECURITY DEFINER` (2026-07-13/07-14 최신 정의). read 함수(banner/today/dup/rrn 등)는 anon 직접호출이므로 §2-A 로 KEEP.

---

## 3. Batch2 권고 (DA 판정용 — 실행은 downstream 별건)

- **KEEP (anon EXECUTE 유지)**: §2-A 7함수 (+ §4 `fn_selfcheckin_verify_reservation` 선결 시 8).
- **REVOKE-eligible**: §2-B 10함수.
- 결과: self-checkin 클러스터 KEEP 17→7(또는 8), REVOKE 10.
- **단, §4·§5 선결 없이는 Batch2 REVOKE 마이그 착지 금지.**

---

## 4. ⚠ CRITICAL — 17-scope 밖 신규 top-level 호출 (Batch2 blocker)

**`fn_selfcheckin_verify_reservation`** (kiosk `SelfCheckIn.tsx` L1493):

```ts
const { data, error } = await anonClient.rpc('fn_selfcheckin_verify_reservation', {
  p_clinic_id: clinicId, p_phone: challengePhone, p_reservation_id: selectedReservation.reservation_id,
});
// → 본인 매칭 1건 raw PII 반환 (reservation_id, customer_id, customer_name, customer_phone, reservation_time, visit_type)
```

- 키오스크 **HEAD 2026-07-15** 가 **top-level anon 으로 직접 호출** (완전한 시그니처 + raw PII 반환).
- 그러나: **Batch2 17-list 밖** + **T-20260710 allowlist(14) 밖** + **Batch1 KEEP-32 밖** + **obliv-foot-crm migration 정의 전무**.
- 함의:
  1. **17-scope 가 불완전**. 2026-07-10 이후 키오스크가 신규 anon RPC 를 추가했고 어떤 allowlist 에도 미반영.
  2. 만약 프로드에 존재 & anon EXECUTE 보유 → **Batch1 동적 sweep**(`KEEP-32 제외 전 anon-exec REVOKE`)이 이미 이 함수를 REVOKE 대상에 포함 → **키오스크 본인확인(verify) 단계 런타임 파손** 위험.
  3. 만약 프로드에 부재 → 키오스크 L1493 호출이 이미 런타임 에러(현장 미신고 잠복 버그).
- **DA 조치 요망**: 프로드 pg_proc 로 `fn_selfcheckin_verify_reservation` 실재·anon acl 확인 후 (a) 실재 시 → **KEEP allowlist 에 추가**(top-level), (b) 부재 시 → 키오스크측 버그로 responder→외부 owner(soyursong) 통보. 어느 쪽이든 Batch1 sweep 최종상태 재검증 필요.

---

## 5. 한계 & 선결조건 (DA 유의)

1. **migration ≠ prod pg_proc**. §2-B 의 "nested 호출 0" 은 obliv-foot-crm migration body grep 기반. 프로드에 OOB(대시보드/외부 생성) 함수·정의가 있을 수 있음. **REVOKE 마이그 착지 전 프로드 `pg_get_functiondef` 로 §2-B 10개가 어떤 함수 body 에서도 미호출임을 introspect 확인** 필요(특히 `self_checkin_lookup`, `fn_selfcheckin_verify_reservation` — migration 정의 부재).
2. **DA 재-CONSULT 회신 경로 부재 확인**: 티켓이 인용한 `da_replies/DA-20260716-foot-STATS-RPC-ANON-EXEC-RECONSULT.md` 는 현재 **레포에 부재**(`da_replies/` 디렉터리 자체 없음). 판정근거로 참조 전 DA 측 실재 확보 요망 — 본 evidence 는 그 재-CONSULT 를 위한 dev-foot 입력.
3. 본 티켓은 db_change=false 조사 전용 → supervisor DDL-diff·대표게이트·E2E 불요(티켓 게이트 규정).
