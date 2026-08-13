# T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — Q4 CLASS C sub-carve census (per-table 재판정)

- 도메인: foot (obliv-foot-crm)
- 성격: **READ-ONLY census · prod write/DDL/DML/apply = 0 · write0** (Leg2 apply 는 supervisor DDL-diff + 물리 GO-token 선행)
- 상위 지시: planner MSG-20260814-003808-jc5c (DA REPLY MSG-20260814-002921-lb8f)
- 근거 doctrine: **Q4 CLASS C = Tier-N/A carve CONFIRM** — discriminant = "이 delete 가 authoritative HISTORY 를 파괴하는가? NO=carve". blanket 금지·per-table 판정.
- FOR DELETE grant sub-doctrine: **CLASS C junction = grant KEEP**(REVOKE 아님). Tier-0/1 만 REVOKE co-atomic.
- census method: `src/**` `.delete()` 콜사이트 정적 분석 + FK/스냅샷/제약 대조(mirror-not-invent)
- 작성: dev-foot 2026-08-14

---

## 판정 요약표

| 테이블 | DA 지정 sub-carve | discriminant 적용 결과 | 최종 disposition | FOR DELETE grant |
|--------|-------------------|------------------------|------------------|------------------|
| `reservation_registrars` | (1) comp/attribution-history · junction 재분류 재판정 | 스냅샷(registrar_name)+FK ON DELETE SET NULL → history-safe | **CARVE (CLASS C · hard-DELETE KEEP)** | **KEEP** |
| `duty_roster` | (1) comp/attribution-history → effective-dated | date-keyed 근무'계획' · 감사 SSOT=staff_attendance · toggle/replace | **CARVE (CLASS C · hard-DELETE KEEP)** | **KEEP** |
| `staff_temp_off` | (1) comp/attribution-history → effective-dated | work_date-keyed 가용성 toggle · 감사 아님 | **CARVE (CLASS C · hard-DELETE KEEP)** | **KEEP** |
| `assignment_leadsource_policy` | (2) FK-config-master (FK-참조 시)→upsert+is_active=false | **incoming FK 부재** → 조건 미충족 | **CARVE (CLASS C · config replace 유지)** | **KEEP** |
| `check_in_services` | **carve-FROM-Q4** → voided_at | 매출 line = service_charges Q1 동류 | **CARVE → 기존 voided_at 라우팅** (GAP3) | (voided softvoid) |
| `daily_room_status` | config-toggle carve | ephemeral 당일 상태 · 재활성화-lock 대상 아님 | **CARVE (CLASS C · hard-DELETE KEEP)** | **KEEP** |

---

## ■ (1) comp/attribution-history sub-carve — 재판정

### T1. reservation_registrars — 재판정 = **CARVE (history-safe)**
- 콜사이트: `ReservationRegistrarTab.tsx:171` `.delete().eq('id', r.id)` (등록자 master 행 삭제).
  - `:151·155` = sort_order swap UPDATE(정렬), 삭제 아님.
- **결정적 근거 (스냅샷+FK) — 20260610110000_resv_registrar_route_fields.sql §3**:
  - `reservations.registrar_id UUID REFERENCES reservation_registrars(id) **ON DELETE SET NULL**`
  - `reservations.registrar_name TEXT` = **저장 시점 스냅샷**("마스터 리네임/삭제돼도 고객박스 표시 안정" 주석 명문).
- 삭제 UI 확인문구도 명시: *"이미 사용된 예약의 등록자 표시(스냅샷)는 유지됩니다."*
- → 등록자 master 행 hard-DELETE 시: 사용 예약의 registrar_id 는 SET NULL 되나 **귀속 표시(attribution)는 registrar_name 스냅샷으로 보존**. comp/귀속 read 는 스냅샷(denormalized) 경유이지 master by-reference 아님.
- **discriminant 적용**: authoritative HISTORY 파괴? **NO**(스냅샷 보존) → **CARVE**. "junction 재분류 재판정" 결론 = master picklist(등록자 명부) · 귀속은 예약행에 denormalize · Tier-1 승격 불요.
- FOR DELETE grant = **KEEP** (CLASS C junction).
- ⚠ 후속 조건부 승격 트리거(문서화만): 만약 comp/인센티브가 **registrar_name 스냅샷이 아니라 reservation_registrars 를 report-time 에 by-FK 재조회**한다면 → Tier-1 effective-dated 로 재승격. 현재 census = 스냅샷 read 우세이므로 CARVE 확정.

### T2. duty_roster — 재판정 = **CARVE (근무계획 · date effective-dated)**
- 콜사이트:
  - `DutyRosterTab.tsx:169` `.delete().eq('id', existing.id)` = 근무 toggle 해제(nextRosterType→none, "근무 해제").
  - `DutyRosterTab.tsx:229` `.delete().eq('clinic_id').gte('date',weekStart).lte('date',weekEnd)` = 주간 **replace-sync 덮어쓰기**(재삽입 선행 delete).
  - `DutyRosterImportDialog.tsx:302` = import replace.
- 성격: **date-keyed 근무'계획'(plan)** · toggle/주간 replace 로 갱신. 근태 감사 SSOT 는 별 테이블 `staff_attendance`(Tier-1·CARVE census 기판정). duty_roster 는 실행기록이 아니라 배정계획.
- **discriminant 적용**: authoritative HISTORY 파괴? **NO**(감사 원천 아님·date 로 이미 effective-dated·계획 mutation) → **CARVE**.
- FOR DELETE grant = **KEEP**.
- ⚠ 조건부 승격 트리거: 근무기반 comp(당직수당 등)가 duty_roster 과거행을 by-reference 정산한다면 Tier-1 soft. 현재 = 계획테이블·audit=staff_attendance 이므로 CARVE.

### T3. staff_temp_off — 재판정 = **CARVE (가용성 toggle · work_date effective-dated)**
- 콜사이트: `autoAssign.ts:361` `.delete().eq('staff_id').eq('work_date', today)` = 당일 임시휴무 toggle **off**(on=upsert onConflict staff_id,work_date / off=delete).
- 스키마(20260624170000_staff_temp_off.sql): `work_date` + `idx_staff_temp_off_workdate`. **is_active/cancelled 컬럼 부재**.
- 성격: 자동배정(autoAssign) 이 참조하는 **당일 가용성 toggle** — 근태 감사·comp 원천 아님. work_date 로 본질적 effective-dated.
- **discriminant 적용**: authoritative HISTORY 파괴? **NO**(운영 toggle·감사 아님) → **CARVE**.
- FOR DELETE grant = **KEEP**.
- ⚠ 조건부 승격 트리거: 임시휴무가 근태/comp 분모에 by-reference 반영되면 soft(예: cancelled_at). 현재 = 배정 toggle 이므로 CARVE.

---

## ■ (2) FK-config-master sub-carve

### T4. assignment_leadsource_policy — **CARVE (FK 부재 → 조건 미충족)**
- 콜사이트: `AssignmentSettingsTab.tsx:219` upsert(onConflict `clinic_id,lead_source`) + `:225` `.delete().eq('clinic_id').in('lead_source', deletes)` (strategy='none' 인 정책 제거) — **정책 replace-sync**.
  - 런타임 read: `assignmentStrategy.ts:386` (배정 전략 조회 = current-config).
- **결정적 근거**: `assignment_leadsource_policy` 를 **REFERENCES 하는 incoming FK = 부재**(migrations 전수 grep: 정의/INSERT 만 존재, 타 테이블 FK 참조 0건).
- DA 조건 = "assignment_leadsource_policy(**FK-참조 시**) → upsert + is_active=false". → **FK-참조 부재 → 조건 미충족** → is_active=false 전환 **불요**.
- **discriminant 적용**: authoritative HISTORY 파괴? **NO**(live config replace·'none'=정책부재=default) → **CARVE**. 현 upsert+delete-none 패턴 유지.
- FOR DELETE grant = **KEEP**.
- ⚠ 조건부 승격 트리거: 향후 타 테이블이 policy row 를 FK 참조하게 되면(정책 이력 by-reference) → upsert + is_active=false 소프트 전환. 현재 = FK 부재이므로 CARVE.

---

## ■ carve-FROM-Q4 / config-toggle carve

### T5. check_in_services — **carve-FROM-Q4 → 기존 voided_at 라우팅 (GAP3)**
- DA: check_in_services = 매출 line → **voided_at**(service_charges Q1 동류). 기존 flag 라우팅 = voided_at.
- 콜사이트: `PaymentMiniWindow.tsx:2372·2937` `.delete()` = 결제 편집 시 서비스라인 replace(원 census CLASS C).
- 기존 flag 실재: `check_in_services.voided_at timestamptz NULL` (20260805110000_foot_check_in_services_softvoid.sql) — 이미 배포. **신규 flag 신설 금지(mirror-not-invent)**.
- disposition: 매출 line 무효화는 **기존 voided_at UPDATE 라우팅**(GAP3). deleted_at envelope 대상 아님(매출 line 은 voided_at 축). replace-sync 잔여는 CLASS C 유지.

### T6. daily_room_status — **config-toggle carve (재활성화-lock 대상 아님)**
- 콜사이트: `Staff.tsx:960` `.delete().eq('id', existing.id)` = 당일 방 상태 toggle(ephemeral).
- **discriminant 적용**: authoritative HISTORY 파괴? **NO**(당일 ephemeral 상태) → **CARVE**. 재활성화-lock(soft-delete 재활성 잠금) 대상 **아님**.
- FOR DELETE grant = **KEEP**.

---

## AC / 게이트
- [x] Q4 CLASS C sub-carve per-table 재판정(discriminant='authoritative HISTORY 파괴? NO=carve') — 본 문서. write0.
- [x] reservation_registrars 재판정 = CARVE(스냅샷 registrar_name + FK ON DELETE SET NULL history-safe).
- [x] assignment_leadsource_policy = CARVE(incoming FK 부재 → is_active=false 조건 미충족).
- [x] duty_roster · staff_temp_off = CARVE(date/work_date effective-dated · 감사 SSOT=staff_attendance).
- [x] check_in_services = carve-FROM-Q4 → 기존 voided_at 라우팅(GAP3). daily_room_status = config-toggle carve.
- [x] CLASS C junction FOR DELETE grant = **KEEP**(REVOKE 아님). Tier-0/1 만 REVOKE.
- [ ] 조건부 승격 트리거(각 T1~T4 ⚠) = 향후 by-reference comp/FK 발현 시 planner 재-CONSULT. 현재 write0 = 승격 없음.
- [ ] apply 대상 없음(census only) — Gate-B(DA) 판정 ≠ apply 허가. GO-token 요청 시점 아님.
