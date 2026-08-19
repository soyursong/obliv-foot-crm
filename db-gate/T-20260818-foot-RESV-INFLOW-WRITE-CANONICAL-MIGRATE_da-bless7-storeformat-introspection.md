# T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — DA-BLESS-7 반영 (store-format introspection + 2-table CHECK-widen scaffolding)

- 작성: dev-foot / 2026-08-19
- 근거: planner INFO MSG-20260819-163750-4ck1 (DA-BLESS 수신) + DA CONSULT-REPLY MSG-20260819-163315-f5ey (DA-20260819-foot-INFLOW-VISITROUTE-CHECK-WIDEN-ADDITIVE-BLESS)
- 클래스: **dev prep (write0 / DDL0)** — apply·최종 allowlist 값 = F1(revisit clobber) 해소 + 물리 GO-token 後. 본 아티팩트는 introspection + scaffolding 만.
- ⚠ 티켓 상태 무변: **BLOCKED / human_pending** (F1 미해소). DA bless = apply-gate side 해소이지 F1(ticket-block) 해소 아님.

---

## 1. DA-BLESS-7 확정 사항 (반영)

- **Q1 (CHECK widen = ADDITIVE) = CONFIRM**: allowlist 값추가 · DROP/타입변경/제거 0 · 기존 7값/집계 불변 · backfill 0 → §3.1 CEO 대표 파괴게이트 **면제**.
- **★AC-1 정밀화**: CHECK ADD = DDL → 'DDL-0 carve' **아님** → supervisor MIG-GATE(DDL-diff) + 물리 GO-token **선행 REQUIRED**. '§3.1 면제'/'ADDITIVE' ≠ GO-token/MIG-GATE 면제.
- **Q2 (firewall-neutral) = CONFIRM**: partner.agency / internal.* 를 visit_route capture 축 vocabulary 로 확장 = foot-local capture 축 확장 → §36 3직교축 접촉 0.
- **★2-table co-deploy 원자성**: `customers.visit_route` ∧ `reservations.visit_route` **두 CHECK allowlist 를 동일 widened set 으로 동시 갱신** 필수. 1개만 widen = write fail·divergence. FE 드롭다운 co-deploy 동반.

---

## 2. store-format introspection (READ-ONLY, mirror-not-invent)

### 2.1 현행 저장 포맷 = 한글 라벨 (canonical 코드 아님)

`customers.visit_route` / `reservations.visit_route` 는 **한글 라벨** 문자열을 저장한다 (canonical `inbound.`/`partner.`/`internal.` prefix 코드 축과 **직교**).

- 현행 CHECK allowlist (2-table **대칭**, `20260716160000_foot_visit_route_gonghom_add.sql` 최신):
  ```
  ('TM','워크인','인바운드','지인소개','네이버','인콜','공홈')   -- 7값
  ```
  - DA "기존 7값" 과 byte-정합. `인콜` = legacy 존치(신규 등록 선택지 아님).
- FE 신규-등록 선택지 = `VISIT_ROUTE_OPTIONS` (src/lib/types.ts:985):
  ```ts
  export const VISIT_ROUTE_OPTIONS = ['TM', '네이버', '인바운드', '워크인', '지인소개', '공홈'] as const;
  ```
  (legacy `인콜` 은 표시 목록 밖·현재값 보존만 — `visitRouteOptionsFor`).

### 2.2 canonical 코드 축 = 별도 (§36 방화벽)

- `reservations.inflow_channel` / `check_ins.inflow_channel` / `customers.first_inflow_channel` = **canonical 11코드**(system_codes `code_type=inflow_channel`, `20260801230000`). `inbound.`/`partner.`/`internal.` prefix.
- `src/hooks/useInflowChannels.ts`: "referral_source / visit_route(legacy) 와 **무접점**. canonical 코드값(inbound./partner./internal. prefix)만 취급."
- ∴ DA 회신의 "partner.agency / internal.* 를 visit_route CHECK 저장 문자열값으로 추가" 는 신규 옵션의 **canonical 정체성**을 지칭. 물리 저장 리터럴은 visit_route **한글 라벨 폼**(§2.1) — 이 store-literal 폼이 최종 widened 리터럴 확정의 선결 premise (§4 OPEN-2).

### 2.3 accounting-neutral wiring = by-construction (핵심)

- 배정 substrate = `VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE` (src/lib/types.ts:437), 6 한글 키만 명시 매핑:
  ```
  TM→TM · 인바운드→INBOUND · 워크인→WALK_IN · 네이버→NAVER · 지인소개→REFERRAL · 공홈→HOMEPAGE
  ```
- `deriveAssignLeadSource` (src/lib/assignmentStrategy.ts:74): `VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[raw] ?? 'WALK_IN'`.
- **∴ 신규 widened 한글 라벨을 이 맵에 추가하지 않으면 → 자동 `WALK_IN` 폴백** = 김주연 총괄 CONFIRM "배정 방식=기존 순번대로(워크인과 동일)"(16:09 note (d)) = **money-shift 0 by-construction**.
- 정산: `Closing.tsx:1103 cust.visit_route` read — 신규 라벨은 신규 SEPARATE 정산 버킷(총괄 11:00 지시)로 categorize. WALK_IN 흡수 아님 = 별도 축. → accounting-parity POSTCHECK scope = **배정(WALK_IN neutral byte-동일) + 정산(신규 SEPARATE 버킷 categorization)**. stats = 비결합축(scope 밖).

### 2.4 소비자 census 요약 (기확보, 21:33 note 정합)

| substrate | 소비 위치 | (y) 영향 |
|---|---|---|
| 배정 | assignmentStrategy `deriveAssignLeadSource` (단 1곳) | 신규 라벨 미매핑→WALK_IN 폴백 = neutral |
| 정산 | Closing.tsx:1103 `cust.visit_route` | 신규 SEPARATE 버킷 categorization (총괄 지시) |
| 통계 | stats(reservations.visit_route) | 2번차트 edit 비결합 = scope 밖 |

---

## 3. 2-table CHECK-widen scaffolding (준비 only — apply 금지)

- scaffold SQL = `db-gate/T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE_2table-checkwiden.scaffold.sql` (live `supabase/migrations/` **apply-path 밖**에 배치 = GO-token 前 오배포 물리 차단).
- 패턴 = `20260716160000_foot_visit_route_gonghom_add.sql` 준용(2-table 대칭 DROP+ADD superset 재생성, 멱등, DO$$ 검증 블록).
- **★2-table 원자성**: customers ∧ reservations 를 **한 트랜잭션(BEGIN/COMMIT) 내 동일 widened set** 으로 재생성. 1-table만 widen 금지.
- rollback = 직전 7값 복원. dryrun = 신규값 포함 + 기존 7값 존치 + 위반행 0 검증.
- **widened set 리터럴 = PENDING placeholder** (§4 OPEN 미해소 → 실 리터럴 미확정).

---

## 4. 미해소 입력 (apply 前 필수 — 본 prep 범위 밖)

- **OPEN-1 (F1, ticket-block)**: revisit(재방문) clobber — 재방문 in/out. 김주연 총괄 회신 대기. **최종 allowlist 값 = F1 해소 後.**
- **OPEN-2 (store-literal 폼)**: 신규 SEPARATE 4항목 + 인바운드(카톡)이 visit_route 에 **한글 라벨**(§2.1 폼) vs **canonical 코드**(§2.2 폼) 로 저장되는지 확정. mirror-not-invent — planner/총괄 offered-label 확정 시 fix. (현행 축 = 한글 라벨 → 한글 라벨 폼 유력이나 blind-assert 금지.)
- **OPEN-3 (inbound.kakao enum 게이트)**: "인바운드(카톡)" 신규 canonical 코드 = system_codes ADDITIVE → 별도 DA CONSULT(planner 발행, 11:54 note). visit_route widen 과 별 축(canonical 코드 도메인).

---

## 5. 게이트순서 (변경 없음 — 재확인)

dev census/prep(write0/DDL0, **현 단계**) → [F1 해소 + OPEN-1/2 확정] → planner un-block → dev (y) 구현 finalize(widened literal 확정) → **supervisor MIG-GATE(2-table DDL-diff) + 배정/정산 2축 accounting-parity POSTCHECK + 물리 GO-token(apply_before_go 금지·apply-gate=supervisor NOT DA)** → apply → POSTCHECK(2-table CHECK 대칭·배정 WALK_IN neutral byte-동일·정산 SEPARATE 버킷·기존 7값/집계 불변·substrate 단절 window 0).

money-safety NON-NEGOTIABLE 불변.
