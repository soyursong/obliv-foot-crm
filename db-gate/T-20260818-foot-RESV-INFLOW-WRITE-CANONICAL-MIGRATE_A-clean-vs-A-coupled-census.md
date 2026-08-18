# T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — A-clean vs A-coupled census (READ-ONLY, mirror-not-invent)

- ticket: T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE (Leg-B, P0 money-adjacent)
- author: dev-foot
- date: 2026-08-18
- upstream doctrine SSOT: `da_decision_foot_resv_inflow_write_canonical_migrate_20260818.md` (DA CONSULT-REPLY MSG-20260818-210712-xwnb)
- follows: `_AC0-census.md` (commit c414351d) — 이 문서는 DA §census-gate 4문항(A-clean vs A-coupled 결정자) 전용 심화
- method: repo static census (grep + read). **NO prod query, NO write, NO DDL.** live-population parity counts = supervisor POSTCHECK 소관(prod 필요).
- status: **census 완료 → 판정 = A-coupled → 구현 HOLD until planner (x)/(y) 선택 + 박민지 comp-gate + supervisor GO-token**

---

## 결론 (TL;DR)

**판정 = A-coupled.** 돈-side(배정 라우팅 + 일마감 정산 표시)가 `customers.visit_route`(= 2번차트 mutable edit 가 write 하는 바로 그 필드)를 read 한다. ∴ 2번차트 write 를 event-grain `inflow_channel` 로 옮기면서 배정/정산을 co-rewire 하지 않으면 **substrate 단절**(재분류가 배정/정산에 더는 반영 안 됨 = 거동 변화 = parity 붕괴). DA §A-coupled 정의 정확 충족 → HA3(A-coupled substrate 단절) 회피 위해 **(x) 원자 co-rewire** 또는 **(y) visit_route keep-widen** 필수.

- **new-schema = 0 확인**: event-grain 대상 `reservations.inflow_channel` + `check_ins.inflow_channel` 이미 존재(mig 20260801)·canonical 11-code 도메인 hold·이미 live-write 중(접수 시). 옵션A '신규스키마 0' claim = **TRUE**.
- **coupled-consumer 정정(head-start 대비 축소)**: 2번차트 write 필드(`customers.visit_route`)의 실 소비축 = **배정(autoAssign) + 정산 표시(Closing)** 2곳. **내원 통계(stats.ts)는 `reservations.visit_route` 를 읽고 2번차트 edit 이 reservations 로 전파되지 않음 → 2번차트 edit 과 비결합**(co-rewire 범위에서 제외 가능·POSTCHECK 는 always-sync 무결성만).

---

## census-gate #1 — `customers.visit_route` 를 무엇이·언제 write 하나

| writer | 시점 | 성격 | 파일 |
|---|---|---|---|
| 예약 생성/수정 always-sync | **생성-시점**(reservation create/edit) | `input.visit_route` truthy 시 `customers.update({visit_route})` | Reservations.tsx:347-349 |
| **2번차트 방문경로 edit** | 스태프 재분류(매 onChange) | `saveCustomerField({visit_route})` | CustomerChartPage.tsx:6683 |
| 예약 상세 팝업 편집 | 예약 상세 편집 | sync | ReservationDetailPopup.tsx:1437 |
| 접수 상세 sheet 편집 | 접수 편집 | sync | CheckInDetailSheet.tsx:1292 |
| 키오스크 셀프접수 RPC | anon SECDEF | `fn_selfcheckin_update_personal_info` / `fn_selfcheckin_rrn_match` `UPDATE customers SET visit_route=COALESCE(...)` | mig selfcheckin_visit_route_detail |

**판정**: 2번차트 = **유일 writer 아님**. **생성-시점 writer(Reservations.tsx:347) 존재** → `customers.visit_route` 는 생성 시 이미 값을 가지며, 2번차트는 그 위의 mutable 재분류다. 2번차트 edit → `customers.visit_route` **단독**(reservations 로 전파 없음 — CustomerChartPage 에 customers→reservations sync 코드 부재 확인).

---

## census-gate #2 (dispositive) — report-time 귀속/집계가 무엇을 read 하나

DA 결정자: 돈-side 가 `visit_route`(current mutable) vs `lead_source`(배정 시 1회 확정) 中 무엇을 read?

| 소비축 | read source | 2번차트 edit 과 결합? | 근거 |
|---|---|---|---|
| **배정 라우팅**(money-adjacent) | `customers.visit_route` → `deriveAssignLeadSource({visit_route ?? lead_source})` | **YES(결합)** | autoAssign.ts:786 select `visit_route` · :891 `deriveAssignLeadSource` |
| **일마감 정산 표시**(내원경로) | `cust?.visit_route` | **YES(결합)** | Closing.tsx:1103 `lead_source: cust?.visit_route` |
| 내원 통계(방문경로별) | `reservations.visit_route`(예약 grain) | **NO(비결합)** | stats.ts:721/752 — 2번차트는 customers만 write, reservations 무전파 |

- 배정은 **acquisition-time source(`first_inflow_channel` / creation `lead_source`)를 읽지 않는다** — `deriveAssignLeadSource` raw = `visit_route ?? lead_source`(mutable customer-grain 우선). `first_inflow_channel` 은 배정/정산 어디에서도 read 0.
- 정산 내원경로도 `customers.visit_route`(mutable) 직독.

**∴ 돈-side 가 mutable `visit_route`(2번차트 write 필드)를 read → A-clean 조건('2번차트 mutable edit 미소비') 불성립 → 판정 = A-coupled.**

> DA 가 언급한 "배정=생성 1회 fire·2번차트 재분류가 배정 re-trigger 안 함" = A-clean 유력 신호였으나, **report-time 집계 소비축 census 가 반증**: 배정은 매 check-in 시 `customers.visit_route`(2번차트가 갱신하는 값) 를 재read 하고, 정산은 재분류된 현재값을 표시한다. 재분류 → 후속 배정/정산에 반영됨 = 결합.

---

## census-gate #3 — event-grain 대상이 canonical 11-code 도메인을 이미 hold 하나 (신규스키마 0 검증)

- `reservations.inflow_channel` text (mig 20260801160000/230000) — canonical 11-code system_codes(`code_type='inflow_channel'`) 도메인. 예약 생성 시 write 중(Reservations.tsx:356-393, first-write-wins + 상속).
- `check_ins.inflow_channel` text (동 mig) — 워크인 앵커. 접수 시 write 중(NewCheckInDialog.tsx:397).
- `system_codes` 11종 시드 + `code_availability` 오버레이 + RPC `get_inflow_channels` 존재(useInflowChannels).

**판정: 신규스키마 = 0 (옵션A 전제 TRUE).** event-grain 필드 2개 다 존재·canonical 11-code hold·이미 live-populated. 옵션A 는 code-only 로 event-grain write target 확보 가능(DDL 0).

---

## census-gate #4 — 6-code visit_route ↔ 11-code canonical 매핑 완전성

`VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE`(types.ts:437) = 6키(한글). canonical 11(system_codes) 대조:

| visit_route(6, 한글) | → AssignLeadSource | canonical 11 등가 | 방향 |
|---|---|---|---|
| 워크인 | WALK_IN | inbound.walkin | 1:1 |
| 인바운드 | INBOUND | inbound.phone | 1:1 |
| 네이버 | NAVER | inbound.naver_place | 1:1 |
| 지인소개 | REFERRAL | inbound.referral | 1:1 |
| 공홈 | HOMEPAGE | inbound.homepage | 1:1 |
| **TM** | TM | **(canonical 부재)** | enum-축 잔류(§36·도파민 seed) |

역방향(canonical 11 → visit_route): 위 5 + 다음 6코드는 visit_route 등가 **부재** → 현행 `deriveAssignLeadSource` fall-through = **WALK_IN**:
`inbound.revisit` · `inbound.etc` · `partner.agency` · `internal.center_referral` · `internal.transfer` · `internal.staff`.

**판정**: 매핑 **정의 가능하나 양방향 비전단사(lossy)**. 
- 배정축: 5코드 1:1 byte-parity + TM enum-축 잔류 + 6 신규코드 → WALK_IN fall-through(현행과 동일 = **배정 accounting-neutral**).
- **단 reporting/attribution 축**(정산 내원경로·내원 통계 버킷): 6 신규 canonical 코드가 visit_route 에 저장되면 **신규 버킷 출현**(현행 6 버킷 → 최대 11 버킷). 이 5(TM 제외)~6 신규코드의 귀속 = **박민지 comp-gate 결정**(DA: "6 기존코드 byte-parity + 5 신규코드 = 박민지 귀속 결정").

---

## sub-case 요구 — (x) co-rewire vs (y) keep-widen

A-coupled 이므로 DA §A-coupled 상 다음 中 하나 필수(둘 다 money-affecting → GO-token 선행):

### (x) 배정/정산 event-grain 원자 co-rewire (byte-parity)
- 배정(`deriveAssignLeadSource` source) + 정산(Closing 내원경로)를 `customers.visit_route` → event-grain `inflow_channel`(COALESCE latest event ?? first_inflow_channel ?? visit_route 폴백) 로 원자 이동.
- **위험**: money-critical 2축 동시 재배선 + historical 행(inflow_channel=NULL 과거 고객) 배정 파손 방지 backfill/COALESCE. 단절 window 0 필수. blast 큼.
- 통계축(stats)은 reservations.visit_route 유지 → co-rewire 범위 밖(always-sync 무결성만 POSTCHECK).

### (y) visit_route keep-widen (★dev 권고 — 최소 blast)
- `customers.visit_route` 를 accounting-coupled mutable 기질로 **존치**(배정/정산 parity by-construction 보존).
- 두 드롭다운(예약생성 ↔ 2번차트) offered-set 을 canonical 11-code 로 통일(reporter ask 충족).
- `VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE` 를 canonical 코드도 인식하도록 **확장**(TS 상수 — **DDL 0**): 6 기존(한글) byte-parity + canonical 5(inbound.walkin/phone/naver_place/homepage/referral) 동일 enum + 신규 6(revisit/etc/partner.agency/internal.×3) → WALK_IN(배정 neutral).
- **db_change**: 최소 (y) = **DDL 0**(map=TS 상수·event-grain 신규 0·backfill 0). visit_route 에 canonical 코드 혼입(polyglot dialect) 발생 = 정산/통계 신규 버킷 → **박민지 귀속 결정 대상**.
- **미결**: 신규 6코드 저장 시 정산/통계 버킷 attribution = 박민지. TM 은 canonical 부재 → 2번차트에서 TM 미노출 or enum-축 별도(§36).

---

## money-safety 게이트 (NON-NEGOTIABLE — 어느 sub-case든)

1. supervisor **code-gate + 배정 accounting-parity POSTCHECK**: before/after 배정 lead_source + report-time 귀속(정산 내원경로) + 통계 stats.ts **byte-동일**.
2. **shift-risk 집단 측정(supervisor, prod)**: `first_inflow_channel`·`visit_route` 값 불일치 고객, 그리고 신규 6코드 저장 발생 시 정산/통계 버킷 이동 규모 → **0 아니면 박민지 comp-gate + reporter confirm**.
3. (x)/(y) 中 schema/backfill 발생 시 → supervisor **DDL-diff + MIG-GATE + 물리 GO-token 선행**(apply_before_go 금지·apply-gate=supervisor NOT DA).
4. `first_inflow_channel` write 0(immutability byte-preserved) · 옵션B(신규 customers 컬럼) 미착지 · 옵션C 미착지 · §36 label 무변 · TM inflow 축 미주입.

---

## write0/DDL0 상태 (본 census turn)

- prod 코드 **무접촉**. event-grain write / 배정 재배선 / 드롭다운 widen **미구현**(money-affecting → HOLD).
- 본 커밋 = census 아티팩트(docs) only. **NO DDL · NO write · NO deploy-affecting code.**
- 다음 게이트: planner (x)/(y) 선택 + (신규코드 attribution)박민지 comp-gate + supervisor 물리 GO-token → 그 후 dev-foot 구현(write0/DDL0 until GO-token).

## dev-foot 권고 (non-binding — 결정=planner/박민지/DA)

**(y) keep-widen** = 최소 blast·DDL 0·visit_route 배정/정산 parity by-construction 보존. 유일 개방 결정 = 신규 6코드 정산/통계 귀속(박민지) + TM 노출 정책. (x) 는 event-grain 을 진짜 substrate 로 승격하고 싶을 때의 선택지이나 배정+정산 2축 원자 재배선+backfill 로 위험/비용 큼.
</content>
</invoke>
