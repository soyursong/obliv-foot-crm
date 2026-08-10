# T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP — AC-1 READ-ONLY census 결과 (착수 게이트)

- 실행: dev-foot · 2026-08-10 · **READ-ONLY (SELECT only, WRITE 0 · DDL 0 · DML 0)**
- 인증 컨텍스트: **Supabase Management API `POST /v1/projects/rxlomoozakkjesdqjtvd/database/query`** (PAT, service-level, RLS bypass) → 0-row 결과는 진성 데이터이지 RLS 마스킹 아님(Cross-CRM 진단 인증컨텍스트 표준 준수).
- census 러너: `scripts/T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL_ac0_census.mjs` (SELECT-only 가드 내장)
- 원 산출 JSON: `scripts/out/T-20260810-foot-COORD-REGISTRAR-DUP-DEDUP-BACKFILL_ac0_census.json`

---

## ★ 헤드라인: 티켓의 추정 RC가 **데이터로 반증(FALSIFIED)**

티켓 추정 RC = "강다연·이진석에게 **기존 수동행(staff_id IS NULL)** ↔ **신규 staff_id 링크행**이 공존 → reservation_registrars 2행 → 근무캘린더 2중 표시."

**실측 결과: 강다연·이진석의 reservation_registrars 행은 각각 정확히 1행뿐이며, 그 1행은 트리거가 만든 staff_id 링크행이다. NULL 수동행은 존재하지 않는다.** 따라서 티켓이 지시한 AC-2(=NULL 수동행 archive-제거)는 강다연·이진석에게 **대상 행이 없는 no-op**이며, 실행해도 2중 표시가 해소되지 않는다.

### 강다연·이진석 reservation_registrars 전수 (각 1행)
| id | name | group | staff_id | clinic_id | created_at |
|----|------|-------|----------|-----------|-----------|
| 00f04818… | 강다연 | 원내 | 0ff81a68… (링크) | 74967aea(종로) | 2026-08-10 02:15:21Z |
| 88353cd4… | 이진석 | 원내 | 884b4571… (링크) | 74967aea(종로) | 2026-08-10 02:15:04Z |

→ NULL 수동행 0. 진성 registrar 중복 0.

---

## ★ 실제 RC: **중복 staff 레코드** (registrar 아님)

강다연·이진석은 **활성 coordinator staff 레코드를 각각 2개** 보유. 근무캘린더/드롭다운이 이를 렌더하면(또는 name-join으로 fan-out하면) 2중 표시된다.

### 활성 coordinator staff-record 중복 census (staff 테이블) — freeze 후보 = 정확히 {강다연, 이진석}
| name | active 레코드 수 | ids (created_at 순) | created_at |
|------|-----------------|---------------------|-----------|
| 강다연 | 2 | 4bcf55a2… / 0ff81a68… | 08-08 11:12:36Z (pre-trigger) / 08-10 02:15:21Z (post-trigger) |
| 이진석 | 2 | 9a429fb7… / 884b4571… | 08-08 11:12:52Z (pre-trigger) / 08-10 02:15:04Z (post-trigger) |

- 부모 트리거 `trg_foot_coord_autosync_registrar`는 2026-08-09 16:47Z LIVE.
- 각 인물의 **08-08 레코드**(pre-trigger)는 registrar 링크 없음(linked_reg=0). **08-10 레코드**(post-trigger)가 트리거를 발화시켜 registrar 링크행을 생성(linked_reg=1).
- 즉 **staff 레코드가 08-10에 재등록되어 중복**된 것이 1차 원인이고, registrar 링크행 1개는 그 결과(정상 파생)일 뿐 중복이 아니다.
- 다른 활성 coordinator(김민경·김지혜·박민석·장예지 등)는 **1레코드**(중복분은 2026-07-20 `[중복정리 2026-07-20]` 라벨로 active=false 처리된 선례 존재). 강다연·이진석만 이 정리가 안 됨 → reporter 지목 집합과 정확 일치.

---

## ★ 부차 발견: reservation_registrars "중복"은 진성 중복 아님 (2지점 seed)

C2에서 name+group >1행으로 잡힌 8쌍(원내 김민경·김지혜·박민석·장예지 / TM 김효신·문해민·이수빈·진운선)은 전부 **staff_id IS NULL 쌍**이며 구분축은 **clinic_id**:
- 74967aea = **오블리브의원 서울오리진점 (jongno-foot)** — 라이브
- b4dc0de5 = **오블리브 풋센터 송도 (songdo-foot)** — 제2지점

즉 동일 명단을 **종로+송도 2지점에 각각 seed**한 다중테넌트 행(모두 2026-06-10 seed 시각). clinic_id 필터가 걸린 화면에서는 각 지점 1행만 보이므로 **진성 within-clinic 중복이 아니고, reporter가 지목하지도 않았으며, 부모 트리거와도 무관**. → **정리 대상 아님. 건드리지 말 것.**

### envelope-out 검사 (전부 clean)
- C5 (링크행의 staff가 비-coordinator/부재): **0건**
- C6 (동일 (staff_id, group) 2행+ = 멱등키 위반/트리거 재발결함): **0건** → 멱등키 `reservation_registrars_staff_group_uidx` 정상 작동, 트리거 재발 없음.
- C7 partial UNIQUE idx / C8 트리거 prod 실재 확인 ✔.

---

## ★ 판정 → planner FOLLOWUP + DA CONSULT 승격 권고

1. **티켓 AC-2(registrar NULL 수동행 archive)는 강다연·이진석에 대해 no-op** — 실행해도 증상 미해소. 그대로 진행 금지.
2. **실제 정리 대상 = 중복 staff 레코드**(강다연: {4bcf55a2, 0ff81a68} 중 1개, 이진석: {9a429fb7, 884b4571} 중 1개). 이는 **다른 테이블·다른 축(직원 식별 레코드)** 이며 archive-first registrar SOP가 아니라:
   - staff-record 정정 = **C28-class destructive staff-record 정정**(identity DB-ground-truth 게이트) + 2026-07-20 선례(`[중복정리]` deactivate+rename) 준용 대상.
   - canonical staff 레코드 택일 술어(어느 id 보존? 08-08 원본 vs 08-10 링크보유분?)가 **자명하지 않음** — 08-10 레코드를 지우면 registrar 링크행도 ON DELETE SET NULL로 끊기고, 08-08을 지우면 재등록 이력이 canonical이 됨. FK/링크 의존 있음.
   - → 티켓 명시 게이트("dedup 술어가 자명하지 않으면 DA CONSULT 승격") 발동. **DA CONSULT 승격** 권고.
3. **registrar 2지점 seed 행은 정리 대상 아님**(진성 중복 아님·reporter 미지목).
4. prod write 미실행(READ-ONLY only). supervisor DB-GATE GO-token 미발행 상태이며, 애초에 티켓이 authorize한 정리(registrar archive) 자체가 오조준이므로 apply 진행 안 함(apply_before_go 준수 + 오조준 방지).
