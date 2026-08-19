# T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — 정산 SEPARATE = schema(신규 버킷 컬럼) vs code-only categorization census (READ-ONLY)

- ticket: T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE (Leg-B · P0 · money-adjacent)
- author: dev-foot
- date: 2026-08-19
- trigger: RESUME MSG-20260819-155809-oki5 (all human_pending RESOLVED · 배정 방식=A 워크인 동일). planner 구현방향 #3: "신규 4코드 정산 귀속 = SEPARATE 별도 정산 버킷/축 → **schema(신규 정산 버킷 컬럼) vs code-only categorization = 구현 census 로 확정**".
- upstream: `_A-clean-vs-A-coupled-census.md`(9678c95d, 판정=A-coupled·(y) keep-widen) · DA SSOT `da_decision_foot_resv_inflow_write_canonical_migrate_20260818.md`
- method: repo static census (grep+read). **NO prod query · NO write · NO DDL.** live-population = supervisor POSTCHECK 소관.
- status: **census 완료 → 판정 = 정산 SEPARATE = code-only categorization(신규 버킷 컬럼 0). 단 (y) keep-widen 자체가 visit_route CHECK-allowlist ADD DDL 을 강제(공홈 선례) → db_change=true(frontmatter 정합). + 3 material findings(money-adjacent scope) → planner FOLLOWUP.**

---

## 결론 (TL;DR)

**Q(RESUME #3) = 정산 SEPARATE 은 schema(신규 버킷 컬럼) 필요 없다 = code-only categorization.**

Closing(일마감) 정산의 "내원경로" = **per-row `customers.visit_route` 문자열 직표시**(집계/GROUP BY/버킷 축 부재). 신규 4코드가 각각 "별도 정산"으로 잡히는 유일 mechanism = **distinct visit_route 문자열**로 저장되어 per-row 리스트에 자기 값으로 표시되는 것. → **신규 정산 버킷 컬럼/집계 테이블 = 0**.

**단** — (y) keep-widen 이 신규 값을 `customers.visit_route`(+`reservations.visit_route`)에 저장하려면 **CHECK 제약 allowlist ADD DDL 이 필수**(공홈 선례 `20260716160000` 동형). store-format(canonical 코드 vs 한글 라벨) 불문 동일. ∴ **DA doc §76 (y)="DDL 0" 전제는 census 로 반증** → (y)=db_change=true(MIG-GATE+물리 GO-token). frontmatter `db_change: true`·`risk_verdict: BLOCK` 와 정합(신규 surprise 아님).

이 CHECK DDL 은 **"정산 버킷 컬럼"이 아니다** — visit_route 저장-allowlist widen(어떤 신규 값이든 저장하려면 필요한 기질). 정산 categorization 축은 여전히 code-only(visit_route 값 자체가 곧 카테고리).

---

## 근거 census

### C1 — Closing 정산 categorization = per-row 표시(집계 없음)

| 지점 | 성격 | 근거 |
|---|---|---|
| enrichedRows 단건 결제 | `lead_source: cust?.visit_route ?? null` (per-row) | Closing.tsx:1103 |
| enrichedRows 패키지 결제 | 동일 per-row | Closing.tsx:1159 |
| 수기입력 dialog | `lead_source: leadSource` (per-row) | Closing.tsx:1202/3005/3089 |
| 표 렌더 | `<td>{r.lead_source ?? '-'}</td>` (per-row 셀) | Closing.tsx:2427 |
| 엑셀/출력 | per-row 컬럼 '내원경로' | Closing.tsx:1522/1528/1568/1614 |

- **GROUP BY / reduce / 버킷 by 내원경로 = Closing 내 0건**(grep 전수). 정산은 결제행별 내원경로 라벨 표시일 뿐 경로별 합산 리포트 없음.
- ∴ 신규 4코드 "별도 정산" = distinct visit_route 문자열 저장 → per-row 리스트에 자기 라벨로 노출. **신규 컬럼/집계 불요 = code-only.**

### C2 — 유일 집계 축(stats VisitRouteSection) = event-grain·scope 밖

- `src/components/stats/VisitRouteSection.tsx` = 방문경로별 내원 **건수 집계**(bucketOf, GROUP BY 有). 그러나 소스 = `reservations.visit_route`(예약 grain), **2번차트 customers edit 과 비결합**(customers→reservations 무전파, 선행 census 확인). RESUME 명시 "stats=event-grain 별축·scope 밖". accounting-parity POSTCHECK scope=배정+정산 2축(stats 제외).
- 부작용(정보): 신규 코드가 `reservations.visit_route` 에 저장되면 이 stats 도넛/표에 **신규 버킷 자동 출현**(순서=VISIT_ROUTE_OPTIONS widen 따라감). 무해·비결합·scope 밖이나 기록.

### C3 — visit_route CHECK 제약 실재 (DDL 강제 근거)

- `customers.visit_route` + `reservations.visit_route` = CHECK allowlist 제약(현행 7값: `'TM','워크인','인바운드','지인소개','네이버','인콜','공홈'`). 근거 mig `20260716160000_foot_visit_route_gonghom_add.sql`:27-41.
- 신규 값('해외환자 유치 에이전시' 등 or 'partner.agency' 등) 저장 = CHECK 위반 → **DROP+ADD superset DDL 필수**(공홈 선례 동형·2 테이블). store-format 불문.
- ∴ **(y)=DDL 0 반증**. (y) 최소치 = CHECK allowlist ADD(순수 ADDITIVE·기존값 존치·기존행 UPDATE 0).

### C4 — 배정 neutral = 이미 fall-through 보장 (byte-safe)

- `assignmentStrategy.ts:74` `return VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[raw] ?? 'WALK_IN';`
- 신규 코드는 map 부재 → **자동 WALK_IN fall-through** = 배정 neutral **by construction**(RESUME 배정방식 A=워크인 동일 정합·money-shift 0). map 명시 추가는契約 codification(거동 무변).

### C5 — offered-set surface 전파 (SSOT 1곳)

- `VISIT_ROUTE_OPTIONS` / `visitRouteOptionsFor`(types.ts:985/994) = 단일 SSOT. 소비: CustomerChartPage(2번차트) · Reservations · ReservationDetailPopup(:925 raw + :1837 optionsFor) · CheckInDetailSheet(2곳) · stats VisitRouteSection(순서). → SSOT widen 1회로 전 offered 드롭다운 전파.

### C6 — offered-set "TM 제외 10개" 정합 후보

- 현 VISIT_ROUTE_OPTIONS(6): TM/네이버/인바운드/워크인/지인소개/공홈.
- 후보 통일목록(10) = ex-TM 5(워크인·인바운드·네이버·지인소개·공홈) + 신규 5(기존 고객 재방문·해외환자 유치 에이전시·타센터 연계·병원 인계·임직원·가족) = **10 (TM 제외)**. canonical 11 中 inbound.phone(전화 문의)=기존 '인바운드' 로 흡수 가정·inbound.etc(기타)=미노출 가정 시 정합.

---

## 판정 요약 (RESUME #3 답)

| 질문 | census 판정 |
|---|---|
| 정산 SEPARATE = 신규 버킷 컬럼(schema)? | **아니오(0).** code-only categorization(visit_route 값=카테고리·per-row 표시). |
| 정산 SEPARATE = code-only? | **예.** distinct visit_route 문자열 저장으로 충족. |
| (y) keep-widen = DDL 0? | **아니오.** visit_route CHECK-allowlist ADD DDL 필수(2 테이블·ADDITIVE·공홈 선례). db_change=true. |
| 배정 neutral 추가 코드 필요? | **아니오.** fall-through `?? WALK_IN` 이미 보장(map 명시=契約 codification only). |

---

## ★ material findings → planner 확정 필요 (money-adjacent · 추정 착수 금지)

정산 SEPARATE=code-only 는 확정. 단 write-bearing 구현 전 아래 3건은 **정산 categorization 바이트(money-adjacent)** 를 확정하므로 planner AC 핀 필요(HA3/HA4 회피·under-correct≫over-correct):

- **F1 (revisit attribution clobber 위험)**: RESUME "inbound.revisit=기존 재방문 흡수(별도 아님)" vs 4코드 "SEPARATE(별도)". Closing 집계 부재 시 둘 다 per-row distinct 문자열로 동일 거동 → "흡수 vs 별도" 는 현 코드상 **no-op**. 단 revisit 를 visit_route 드롭다운에 노출·저장하면 재방문 고객의 **원 획득경로(visit_route)를 덮어씀 = acquisition attribution clobber**(money-adjacent 손실). ∴ revisit 는 (a)드롭다운 미노출(원경로 보존·offered=9) or (b)노출하되 정산 원경로 보존 규칙 = **planner/reporter 확정**. offered "10" 정합과 상충(10이면 revisit 노출).
- **F2 ("별도 정산" 리포트 부재)**: reporter "정산 다 별도로 잡아줘" 를 (i) per-row 리스트에 각자 라벨로 표시(=현 code-only 로 충족) vs (ii) **경로별 합산 정산 리포트**(4코드 별도 축·미존재=신규 feature) 中 무엇으로 해석? Closing 엔 (ii) 집계 리포트 없음. (ii)면 구현 shape 확대(신규 feature). **reporter confirm 대상.**
- **F3 (TM 제외 = 배정-enum 노출 변경)**: "TM 제외 10개" → VISIT_ROUTE_OPTIONS 에서 TM active 노출 제거(ReservationDetailPopup:925 등 raw 소비 surface 영향). 기존 TM 행 = CHECK+map+LEGACY 로 byte-parity 존치. store-format(신규=한글 라벨 vs canonical 코드)도 함께 확정(신규 forward-only→기존 바이트 무영향이나 정산 표시 문자열 결정).

---

## money-safety 게이트 (NON-NEGOTIABLE · 불변)

1. supervisor code-gate + **배정/정산 2축 accounting-parity POSTCHECK**(배정 deriveAssignLeadSource lead_source + 정산 Closing cust.visit_route **before/after byte-동일**). 신규 코드 forward-only(historical 0)→기존 바이트 무변 by construction.
2. (y) CHECK-allowlist ADD = DDL → supervisor **DDL-diff + MIG-GATE + 물리 GO-token 선행**(apply_before_go 금지·apply-gate=supervisor NOT DA).
3. `first_inflow_channel` write 0(immutability byte-preserved)·옵션B/C 미착지·§36 label 무변·TM inflow 축 미주입.
4. 박민지 도파민TM comp-gate = MOOT(배정 A=WALK_IN neutral·money/attribution shift 0). partner.agency 별도 정산이 cross-CRM comp 에 닿는 shift 판명 시에만 재발화.

## write0/DDL0 상태 (본 census turn)

- prod 코드 무접촉. offered-set widen / CHECK DDL / map 확장 **미적용**(F1~F3 planner 확정 후 write-bearing 구현·write0/DDL0 until GO-token).
- 본 커밋 = census 아티팩트(docs) only. **NO DDL · NO write · NO deploy-affecting code.**

## dev-foot 권고 (non-binding — 결정=planner/reporter)

- 정산 SEPARATE = code-only(신규 버킷 컬럼 0) 확정 → schema 축소·최소 blast.
- write-bearing 구현 = F1(revisit 노출/attribution)·F2("별도 정산" 해석)·F3(TM 제외+store-format) 확정 수신 후 착수. 확정 시 code+CHECK-DDL(공홈 선례 동형) 로 deadline 08-25 내 안전착지 가능.
