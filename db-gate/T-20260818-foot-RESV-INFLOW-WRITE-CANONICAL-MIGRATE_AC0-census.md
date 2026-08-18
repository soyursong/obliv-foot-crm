# T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — AC-0 census (READ-ONLY, mirror-not-invent)

- ticket: T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE (Leg-B, P0 expedite, money-adjacent)
- author: dev-foot
- date: 2026-08-18
- status: **census complete → 2 dispositive doctrine gaps surfaced → write0/DDL0 HOLD pending planner/DA**
- method: repo static census (grep + read). NO prod query, NO write, NO DDL. Live-population parity counts = supervisor POSTCHECK (needs prod).

---

## 결론 요약 (TL;DR)

1. **AC-0#1/#5 (소비자 전수)** — census head-start("소비자 단1곳=deriveAssignLeadSource")는 **함수 기준으로만 참**. 실제 배정-critical read of `customers.visit_route` 은 `maybeAutoAssign`(autoAssign.ts:891) 이며, `deriveAssignLeadSource` 는 **2곳**에서 호출된다(autoAssign:891 = customers.visit_route / assignmentStrategy:648 = reservations.visit_route). 추가로 `deriveConsultAxis`(집계/라벨 축)·`stats.ts`·`Closing.tsx`(일마감 정산 표시)·selfcheckin RPC 2종이 visit_route 를 소비/기록한다. **surface = head-start 가정보다 materially 큼.**
2. **AC-0#2 (매핑 정의성)** — canonical 11 → AssignLeadSource 매핑은 **정의 가능**(§매핑표). 동일 유입 → 동일 결과 재현 가능(per-input accounting-neutral).
3. **AC-0#3 (historical 무회귀)** — COALESCE(first_inflow_channel-유도, visit_route-유도) 로 backfill **불요**(historical first_inflow_channel=NULL → visit_route 폴백 → 현행과 동일). under-correct ≫ over-correct 로 backfill 회피 권장.
4. **AC-0#4 (매핑 완전성)** — 11코드 전부 write target 확보(canonical 도메인=write 대상). 단 TM/재진은 canonical 11에 **부재** → 배정 enum 축 잔류(§36, AC-1 명시)로 별도 처리.
5. **★GAP-1 (dispositive)** — 2번차트 방문경로 = **mutable 스태프-edit surface**(CustomerChartPage:6664 `saveCustomerField({visit_route})` 매 변경 write). DA target `customers.first_inflow_channel` = **immutable first-touch(first-write-wins)**. **edit 를 immutable 컬럼에 write = 의미 충돌.** AC-1 dual-write escape("census 가 원자 (b) 불가 실증 시 브리지 재고") 트리거.
6. **★GAP-2 (accounting-neutral)** — 배정 재배선의 정확한 source 컬럼이 GAP-1 해소에 **의존**(2번차트가 first_inflow_channel vs reservations/check_ins.inflow_channel vs 신규 mutable canonical 중 어디에 write 하느냐). GAP-1 미해소 상태에서 배정 COALESCE 를 확정하면 invent-not-mirror. ∴ **배정 재배선 코드도 write0 HOLD.**

---

## AC-0#1 / #5 — `visit_route` 전(全) 소비자 census

### customers.visit_route

**WRITE (4 app + 2 RPC):**
| site | 성격 |
|---|---|
| `src/pages/CustomerChartPage.tsx:6672` | **2번차트 edit(대상)** — `saveCustomerField({visit_route})` |
| `src/pages/Reservations.tsx:348` | 예약생성/수정 시 always-sync (`update({visit_route:input.visit_route})`) |
| `src/components/ReservationDetailPopup.tsx:1437` | 예약 상세 편집 sync |
| `src/components/CheckInDetailSheet.tsx:1292` | 접수 상세 sheet edit |
| `migrations …selfcheckin_visit_route_detail.sql` `fn_selfcheckin_update_personal_info` | 키오스크 셀프접수 RPC (anon SECDEF) `UPDATE customers SET visit_route=COALESCE(...)` |
| 동 파일 `fn_selfcheckin_rrn_match` | RRN 매칭 병합 시 visit_route 병합 |

**READ (배정/정산/통계/표시):**
- **배정(money-critical):** `autoAssign.ts:786` select → `:894` `maybeAutoAssign` → `deriveAssignLeadSource`. 또한 `autoAssign.ts:1275` select(2nd 경로), `deriveConsultAxis`(autoAssign.ts:138) = 집계/라벨 축.
- **정산(일마감):** `Closing.tsx:1103` `lead_source: cust?.visit_route`(내원경로 표시), `Closing.tsx:748` select.
- **통계:** `VisitRouteSection.tsx:43` bucketOf. (주의: stats.ts 본체는 reservations.visit_route — 아래 참조)
- **표시:** Reservations.tsx(3612,1714), Dashboard.tsx:1782(coalesce referral_source), CheckInDetailSheet(753/857/863), ReservationDetailPopup(587/599), consultInflowLabel.ts:121, Assignments.tsx(803/872 → deriveConsultAxis).

### reservations.visit_route
- **WRITE:** Reservations.tsx(419 insert, 1817 canonical create, 3942 update), ReservationDetailPopup.tsx:1421.
- **READ(배정):** `assignmentStrategy.ts:632` select → `:648` `deriveAssignLeadSource({visit_type,visit_route})` (슬롯 비-TM 카운트).
- **READ(통계):** `stats.ts:752` `fetchVisitRouteResvRows` `.from('reservations').select('...,visit_route,...')` — **내원 통계 substrate = reservations.visit_route**(예약 grain). customers.visit_route 와 always-sync(주석 stats.ts:721).
- **READ(표시):** Reservations.tsx 다수, Assignments.tsx(607/658).

### ★AC-0#5 판정 — 이중 substrate 정정
ticket AC-0#5 "visit_route = 배정 + 통계(stats.ts) 이중 substrate" → **정정**: 배정은 `customers.visit_route`, 통계(stats.ts)는 `reservations.visit_route` 를 읽는다(다른 컬럼, always-sync 로 연결). ∴ accounting-parity POSTCHECK 는 **(a) 배정(customers축) + (b) 통계(reservations축) + (c) 정산 표시(Closing customers축)** 세 축 모두 before/after 동일을 검증해야 한다. 통계축(reservations.visit_route)은 2번차트 write-swap(customers 대상)의 직접 대상이 아니므로 무접촉 유지가 기본(canonical 유도 재배선 불요) — 단 always-sync 경로가 끊기면 간접 영향 → POSTCHECK 대상.

---

## AC-0#2 / #4 — canonical 11 → AssignLeadSource 매핑 (정의성·완전성)

현행: `VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE`(types.ts:437) 6키 → enum. 제안 canonical map (accounting-neutral 미러):

| canonical code (system_codes) | label | → AssignLeadSource | 현행 visit_route 등가 | 비고 |
|---|---|---|---|---|
| inbound.walkin | 워크인 | WALK_IN | 워크인 | 1:1 |
| inbound.phone | 전화 문의 | INBOUND | 인바운드 | 1:1 |
| inbound.naver_place | 네이버 | NAVER | 네이버 | 1:1 |
| inbound.homepage | 공식 홈페이지 | HOMEPAGE | 공홈 | 1:1 |
| inbound.referral | 지인 소개 | REFERRAL | 지인소개 | 1:1 |
| inbound.revisit | 기존 고객 재방문 | (returning skip) → WALK_IN | — | 재진은 배정 상위서 skip |
| inbound.etc | 기타 | WALK_IN | (fall-through) | 현행 fall-through 동일 |
| partner.agency | 해외환자 에이전시 | WALK_IN | (fall-through) | ※TM 아님 — §36 |
| internal.center_referral | 타센터 연계 | WALK_IN | (fall-through) | |
| internal.transfer | 병원 인계 | WALK_IN | (fall-through) | |
| internal.staff | 임직원·가족 | WALK_IN | (fall-through) | |

- **매핑 정의 가능 = YES.** 4코드(phone/naver/homepage/referral)+walkin 이 현행 6경로 비-워크인과 1:1, 나머지 6코드는 현행 fall-through 와 동일하게 WALK_IN → **per-input 결과 불변(accounting-neutral)**.
- **TM 부재(critical):** canonical 11 에 'TM' 없음. 현행 배정은 `customers.visit_route='TM'`(도파민 seed) → TM 라우팅. canonical-only 로 전환 시 TM 소실 → WALK_IN 오배정 = **대규모 shift**. ∴ AC-1 명시대로 **TM 은 enum 축(visit_type/lead_source/source_system)에서 잔류 파생**, inflow 축 주입 금지. 배정 재배선은 clean swap 이 아니라 **hybrid COALESCE**.

---

## AC-0#3 — historical 무회귀 (backfill 필요성)

- 배정 재배선을 `deriveAssignLeadSource(raw = firstInflowChannel-유도 ?? visit_route ?? lead_source)` COALESCE 로 설계하면:
  - historical 고객(first_inflow_channel=NULL, visit_route 有) → visit_route 폴백 → **현행과 동일**(무회귀).
  - 신규 canonical write 고객(first_inflow_channel 有) → canonical 유도.
- ∴ **backfill 불요**(under-correct ≫ over-correct). backfill 강행 = attribution 오염 위험(genuine-first 판정 없이 소급 = HARD REJECT, 기존 §36-4-a 규약과 동일).
- **shift-risk 집단(supervisor POSTCHECK 필수 측정):** first_inflow_channel 과 visit_route 를 **둘 다** 보유하고 **값이 불일치**하는 live 고객 = COALESCE primary 전환 시 배정 shift 후보. 이 집단 규모/영향은 prod 쿼리 필요 → supervisor accounting-parity POSTCHECK 소관. 0 아니면 박민지 comp-gate.

---

## ★GAP-1 (dispositive) — immutable target vs mutable edit surface

- `customers.first_inflow_channel` = **immutable first-touch, first-write-wins**(migration 20260801 주석 line 37-38, Reservations.tsx:384 `.is('first_inflow_channel', null)` 가드, 불변성 물리 트리거 Phase-2 예정).
- 2번차트 방문경로(CustomerChartPage:6664-6682) = **스태프가 언제든 변경**하는 edit dropdown. 매 onChange 마다 write.
- ∴ **"2번차트 → first_inflow_channel canonical write"(DA §Q2 target-b as-stated) = 불변성 의미와 충돌.** first-touch(최초유입, 불변)에 later 스태프 정정을 덮어쓰면 first-touch 의미 파괴, 안 덮으면 2번차트 edit 무효(저장 안 됨).
- **AC-1 escape 트리거:** "census 가 원자 (b) 불가 실증 시에만 브리지가 명시 transitional 로 재고" → **본 census 가 실증.** 필요한 doctrine 결정(planner→DA):
  - (옵션 A) 2번차트 edit 은 **event-grain mutable** 컬럼(reservations.inflow_channel / check_ins.inflow_channel)에 write, customers.first_inflow_channel 은 first-touch 로 불변 유지. 배정은 latest event inflow_channel COALESCE first_inflow_channel 유도.
  - (옵션 B) 신규 **mutable canonical** 컬럼(예: customers.current_inflow_channel) 도입 → 2번차트 edit 대상. (신규 컬럼 = DA schema-gate.)
  - (옵션 C) first_inflow_channel 불변성 **완화**(스태프 정정 허용) — first-touch 의미 폐기. (attribution SSOT 훼손 위험 = DA doctrine.)
- **dev 은 doctrine 미결정.** 어느 컬럼이 canonical mutable write target 인지 확정 전 배정 source 컬럼도 확정 불가 → GAP-2.

---

## ★GAP-2 — 배정 재배선 source 확정이 GAP-1 에 의존

- 배정 COALESCE 의 canonical source 는 GAP-1 결정에 종속:
  - 옵션 A → 배정 = `check_ins/reservations.inflow_channel`(event latest) COALESCE `visit_route`.
  - 옵션 B → 배정 = `customers.current_inflow_channel` COALESCE `visit_route`.
  - 옵션 C → 배정 = `customers.first_inflow_channel` COALESCE `visit_route`.
- GAP-1 미결정 상태에서 배정 코드 확정 = invent-not-mirror + atomicity 위반 위험. ∴ **배정 재배선·2번차트 write-swap 모두 write0/DDL0 HOLD.**

---

## 안전 착지 권고 (dev-foot, non-binding — doctrine=DA/planner)

1. planner→DA: GAP-1 옵션(A/B/C) 확정. dev 권고 = **옵션 A**(event-grain mutable inflow_channel 에 2번차트 edit write, first_inflow_channel 불변 보존, 신규 스키마 0, §36 방화벽 유지). accounting-neutral·backfill 불요·immutability 보존.
2. GAP-1 확정 후 dev 이 배정 COALESCE 재배선(hybrid: TM/returning=enum축 잔류, non-TM=canonical 유도 ?? visit_route 폴백) 구현(write0/DDL0).
3. supervisor: 3축 accounting-parity POSTCHECK(배정·통계·정산 표시 before/after 동일) + shift-risk 집단 규모 측정 → 0 아니면 박민지 comp-gate + reporter confirm.
4. supervisor 물리 GO-token 후 apply. DDL = (옵션 A/C)0 · (옵션 B)신규 nullable 1컬럼 ADDITIVE.

**deadline 08-25 내 안전 착지 가능. 당일 완료 불가(정직 통지) — GAP-1 doctrine 결정이 구현 선행.**
