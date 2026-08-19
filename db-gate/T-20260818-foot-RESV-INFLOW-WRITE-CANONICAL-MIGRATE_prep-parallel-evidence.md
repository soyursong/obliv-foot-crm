# T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — prep 병행 evidence (write0/DDL0)

- ticket: T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE (Leg-B · P0 · money-adjacent)
- author: dev-foot
- date: 2026-08-19
- trigger: planner FOLLOWUP-6 reply **MSG-20260819-162925-bguj** (INFO) — "★prep 병행 허용 (write0/DDL0): (1) store-format prod introspection (2) CHECK-widen mig scaffolding (기존 byte-parity + 신규 placeholder) (3) 배정 WALK_IN neutral 재확인. 단 최종 allowlist 값·apply 는 F1 해소 + DA bless + 물리 GO-token 後."
- status: **prep 3항목 완료. write0/DDL0 유지. 최종 allowlist 값·apply = HOLD until F1(revisit clobber·김주연 총괄) 해소 + supervisor MIG-GATE + 물리 GO-token.**
- gate posture: F1 = ACTIVE ticket-block(human_pending). DA bless = 완료(MSG-20260819-163315-f5ey). 본 turn = prep only(추정 착수 거부).

---

## 결론 (TL;DR)

planner 가 허용한 3개 prep 항목을 write0/DDL0 로 수행. **최종 allowlist 값 finalize·apply 는 하지 않았다**(F1 미해소).

1. **store-format = 한글 라벨** (prod 실측). F3-b mirror-not-invent 확정 근거 = 신규 값도 한글 라벨로 저장(canonical dot-code 아님).
2. **CHECK-widen 마이그 scaffold 생성**(db-gate/*.SCAFFOLD.sql) — 기존 7값 byte-parity + 신규값 PLACEHOLDER(주석) + fail-closed sentinel. supabase/migrations/ 밖에 의도적 배치(자동 적용 차단).
3. **배정 WALK_IN neutral 재확인** — 신규 코드 전부 map 부재 → `?? 'WALK_IN'` fall-through = 배정 neutral by construction(배정방식 A 정합·money-shift 0).

---

## Prep #1 — store-format prod introspection (F3-b mirror-not-invent)

- script: `scripts/T-20260818-...storeformat_introspect.mjs` (READ-ONLY · Management API `/database/query` · pg_constraint 정의문 SELECT only · no write · no DDL).
- prod ref: `rxlomoozakkjesdqjtvd` (foot).

**실측 결과** (2026-08-19):

| 항목 | 값 |
|---|---|
| customers_visit_route_check allowlist | `'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'` (7값) |
| reservations_visit_route_check allowlist | `'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'` (7값) |
| 2-table 정합 | **YES (byte-identical·동형)** — 동시 widen 대상 정합 |
| store-format 판정 | **한글 라벨** (한글 존재 true · canonical dot-code false) |
| 실 저장 distinct (customers) | TM:2033 · 인바운드:113 · 워크인:37 · 네이버:27 · 지인소개:16 · 공홈:8 (전부 한글) |

**판정**: F3-b "mirror-not-invent" = **신규 유입경로 값도 한글 라벨로 저장**해야 한다(byte-parity). `partner.agency`/`internal.staff` 등 canonical dot-code 는 vocabulary 식별자이지 visit_route store 값 아님 → 신규 store 라벨 = '에이전시'/'타센터 연계'/'병원 인계'/'임직원·가족' 등 한글(최종 wording=planner/reporter 확정).
- 기존 repo mig `20260716160000` 선언값과 prod 실재가 byte-identical 확인(ledger↔prod drift 0).
- '인콜' = allowlist 존치이나 실 저장 0건(legacy) → CHECK 에서 byte-parity 존치(제거 금지).

## Prep #2 — CHECK-widen 마이그 scaffold

- file: `db-gate/T-20260818-...check-widen.SCAFFOLD.sql` (★적용 금지·SCAFFOLD★).
- 구성:
  - **기존 7값 byte-parity** 존치(DROP 값 0·prod 실측 미러).
  - **신규값 = PLACEHOLDER 주석**(에이전시·타센터 연계·병원 인계·임직원·가족 = 확정 SEPARATE 4 / 기존 고객 재방문 = **F1-pending** / 인바운드(카톡) = DA enum-gate pending). ARRAY 리터럴엔 기존 7값만 실재.
  - **fail-closed sentinel**: placeholder 미해소 상태로 실행 시 `RAISE EXCEPTION` abort(사고 방지).
  - **2-table co-deploy 원자성**(DA census item): customers ∧ reservations 동일 widened set 동시 갱신(1개만 widen=write fail·divergence).
  - DROP+ADD superset 멱등 패턴(공홈 선례 `20260716160000` 동형) + DO $$ 검증 + 롤백 주석.
- 배치 위치 = `db-gate/`(supabase/migrations/ 밖) → 마이그 tooling 자동 픽업 차단. 최종화 시: F1 확정 → 신규 라벨 확정 → PLACEHOLDER 치환 + sentinel 'RESOLVED' → `supabase/migrations/<ts>_...sql` 로 이관 → supervisor MIG-GATE(2-table DDL-diff) + 물리 GO-token 後 적용.

## Prep #3 — 배정 WALK_IN neutral 재확인

- `src/lib/assignmentStrategy.ts:74` → `return VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[raw] ?? 'WALK_IN';`
- `src/lib/types.ts:437` map = **6엔트리**: TM→TM · 인바운드→INBOUND · 워크인→WALK_IN · 네이버→NAVER · 지인소개→REFERRAL · 공홈→HOMEPAGE.
- 신규 코드(에이전시·타센터 연계·병원 인계·임직원·가족·재방문·카톡) = **map 부재** → `?? 'WALK_IN'` fall-through = **배정 neutral by construction**(comp-gate 배정방식 A=워크인 동일 정합·money-shift 0). map 명시 추가는 契約 codification only(거동 무변).
- '인콜' 도 동일하게 map 부재→WALK_IN fall-through(현행 거동, 무변).

---

## HOLD 경계 (본 turn 미수행 · money-safety NON-NEGOTIABLE)

- ❌ 최종 allowlist 값 finalize (F1 revisit in/out 미확정 → 신규 set 확정 불가).
- ❌ VISIT_ROUTE_OPTIONS(offered-set) widen — FE 드롭다운 변경 미수행.
- ❌ CHECK-widen apply / DDL / prod write — 전무.
- ❌ TM active 노출 제거(F3-a) 코드 반영 — F1 해소 후 write-bearing 구현에서.

## 재개 조건

F1(재방문 노출 시 정산 clobber) 김주연 총괄 confirm 수신 → planner→approved 재개 → dev-foot (y) write-bearing 구현:
1. VISIT_ROUTE_OPTIONS 6→(TM 제외 후 신규 포함) widen + TM active 노출 제거(F3-a).
2. scaffold PLACEHOLDER → 최종 한글 라벨 치환 → supabase/migrations/ 이관.
3. 배정 map = 契約 codification(신규→WALK_IN 명시, 거동 무변).
→ supervisor code-gate + 배정/정산 2축 accounting-parity POSTCHECK + MIG-GATE(2-table) + 물리 GO-token.

## write0/DDL0 상태 (본 turn)

- prod 코드/스키마 무접촉. introspection = READ-ONLY(SELECT). scaffold = 미적용 파일(db-gate). 본 커밋 = docs/scaffold/script only. **NO DDL · NO write · NO deploy-affecting src 변경.**
