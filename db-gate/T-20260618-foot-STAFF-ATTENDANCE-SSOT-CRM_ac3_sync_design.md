# T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — AC-3 sheet→table sync 설계 (design-only)

> dev-foot / 2026-06-18 · **DESIGN ONLY — code HOLD 491fb780 유지**
> 게이트(2조건 AND, planner 직렬화 결정 §3): (a) DA CONSULT = ✅CLEARED (MSG-...-am1i / 초기 dev-foot 회신 ...-dajh, 동일 verdict: S2 staff_attendance GO / S1 duty_roster NO_GO) · (b) AUTOASSIGN-RUN-FAIL-TABSCROLL **현장 confirm done** = ⏳미충족.
> 본 문서는 게이트 전 허용된 design 산출(AC-1 prep 마이그 + AC-3 sync 설계 = read-only/design). **EF 구현코드·배포·DB read 전환은 (b) clear 후.** AC-2(read-swap)는 AC-3 sync live 없이 단독 배포 절대 금지(회귀 가드 §4).

## 0. 소유·의존 (UNIFY + UPSTREAM-OWNS)
- 출근 정본 테이블 `staff_attendance` + sheet→table sync = **단일 공유 primitive, 소유 = 본 티켓**.
- `AUTOASSIGN-SERVERSIDE-REVIEW`(design-only)는 자체 sync 미설계 → 본 테이블을 **consume**. 본 sync는 SERVERSIDE 옵션 B/C가 깨끗이 read하도록 동기화 메타(`source`/`synced_at`) 포함(테이블에 이미 반영됨).
- 두 소비처 동일 행 read = split-brain 없음:
  - (1) 배정화면 '출근 N명' = `SELECT count(*) FROM staff_attendance WHERE clinic_id=? AND date=today AND status='present'`
  - (2) AUTOASSIGN-SERVERSIDE 옵션 B trigger = 동일 테이블 당일 working staff 집합 read

## 1. 아키텍처 — 단일 cron EF `staff-attendance-sync` (write 단독)
```
구글시트(근무 캘린더, gid 341864863…)
   │  GET CSV (gviz)
   ▼
[duty-sheet-read EF]  ← 기존 read-only 프록시 재사용(무변경)
   │  raw CSV
   ▼
[staff-attendance-sync EF]  ← 신규(본 설계). service_role.
   │  1) lib/dutySheet 동형 파서로 {name,date,team} 후보 추출
   │  2) name → staff_id 결정적 매핑(§2)
   │  3) UPSERT staff_attendance ON CONFLICT(clinic_id,date,staff_id)
   │     · source='google_sheet', synced_at=now()
   │  4) 시트에서 사라진 당일 행 reconcile(§4)
   ▼
staff_attendance (SSOT)  → 배정화면·AUTOASSIGN 양 소비처 read
```
- 트리거: pg_cron 또는 Supabase scheduled function. 주기 = **매일 1회(새벽) + 짧은 간격 재동기(예 15분)**. 현장 시트 운영 습관 보존(시트=입력원).
- 파싱 로직은 `src/lib/dutySheet.ts`의 `extractCandidates`/`parseDutyAttendeesByDate`와 **동형 1벌**을 EF(Deno)로 공유/이식. 두 벌 파서 분기 금지(회귀원).

## 2. ★신원 매핑 결정성 (DA 1급 caveat #1) — 자유텍스트 금지
시트는 **직원명 문자열**만 제공(`{name}`). `staff_id`(FK)로의 매핑이 결정적이지 않으면 '출근 N명'이 오염된다. staff 마스터 = clinic당 54건(active 35) = 매핑 모집단(dry-run 실측).

매핑 파이프라인(결정적, 우선순위 순):
1. **정규화**: trim + 공백/특수문자 정리 + NFC. 직급 접미사(원장/팀장 등) 분리.
2. **exact name match** → `staff.name` 정확 일치(active 우선). 1건 매칭 → 확정.
3. **alias 테이블**(필요 시 신규 `staff_name_alias` 또는 staff에 `sheet_alias` 컬럼 — DA consult 별건): 시트 표기≠마스터 표기(별칭·구표기) 흡수.
4. **다중/0건 매칭 = quarantine**: 절대 임의 staff_id 생성·추측 금지. 미매칭은 `sync_unmatched` 로그(또는 staff_attendance 미적재 + 경보)로 격리 → 현장/admin이 alias 보강. **phantom 출근 행 생성 0**.
5. 특수 토큰:
   - `ALL_STAFF_TOKEN`("전직원" 등) → 당일 active staff 전수 전개. 단, 전개 모집단 = **그 팀(team)의 active staff**로 한정(상담/치료 팀 grain 보존).
   - `SUPERVISOR_TOKEN` → 지정 supervisor staff_id 1건.
- 매핑 결과의 **결정성 = 멱등의 전제**. 동일 시트 재파싱 시 동일 staff_id 집합이 나와야 UPSERT가 안전.

## 3. 멱등 (UPSERT)
- `INSERT … ON CONFLICT (clinic_id, date, staff_id) DO UPDATE SET source=EXCLUDED.source, status=EXCLUDED.status, synced_at=now(), updated_at=now()`.
- UNIQUE(clinic_id,date,staff_id) 이미 마이그에 존재 → 중복 sync 무해.
- `source` 우선순위 보호: `manual`(현장 수기)이 이미 있는 행을 `google_sheet` sync가 덮어쓰지 않도록 가드(수기 override 보존). → UPSERT WHERE source<>'manual' 또는 별도 정책. **현장 결정 필요(open §6)**.

## 4. ★synced_at 신선도 알람 + reconcile (DA 1급 caveat #2) — stale 회귀 차단
- **위험**: sync EF가 죽으면 `staff_attendance`는 어제 데이터로 고정 → 배정화면 '출근 N명'이 **조용히 stale** → A안 도입 목적(이중관리 제거)이 오히려 신뢰 무너짐. = AC-2 read-swap 단독 배포가 위험한 근본 이유(회귀 가드 §4).
- **freshness 모니터**: `max(synced_at)` 이 임계(예 sync 주기×2) 초과 stale 시 경보(슬랙/대시보드 배지). 배정화면은 stale 시 '출근 N명' 옆 **stale 표식**(예: "동기 N분 전") 노출 → 현장이 신뢰도 인지.
- **reconcile(당일 사라진 행)**: 시트에서 직원이 당일 명단에서 제거되면 해당 행 `status` 정리. 옵션: (a) DELETE, (b) status='off' soft-mark. soft-mark가 감사·되돌림에 안전 → **(b) 권장**. 단 source='manual' 행은 reconcile 제외(수기 보존).

## 5. 회귀 가드 (planner 직렬화 §4 — 강제 순서)
1. AC-3 sync EF live(staff_attendance가 당일 데이터로 채워짐 + freshness green) **선행/동시**.
2. 그 다음에만 AC-2(배정화면 '출근 N명' read를 시트 직접 → staff_attendance DB로 전환).
3. AC-2 단독 배포 금지 — 빈/stale 테이블 read = '출근 0명' 또는 어제값 회귀.
4. AC-4: Handover/배정 로직/자동배정 동작 무변경. AC-5: 캘린더 등록→배정화면 반영 실데이터 검증.

## 6. open question (code 착수 전 해소 — 신규 DA consult 추가발행 금지, 기존 트랙 활용)
- O1. alias 저장 위치: `staff.sheet_alias` 컬럼 추가 vs 신규 `staff_name_alias` 테이블 — ADDITIVE 소규모. (DA 단건 확인, 0h50/am1i 트랙 내)
- O2. source='manual' override 보존 정책(§3) — 현장(김주연 총괄) 확인 필요. 수기 출근 입력 UI 존재 여부 선확인.
- O3. sync 주기(매일 1회 vs 15분 재동기) — 현장 시트 갱신 빈도 기준. responder 통해 현장 확인.
- O4. team grain(상담/치료) 전개 모집단 — AUTOASSIGN 후보풀 grain과 정합 맞춤(SERVERSIDE 옵션 B와 read 계약 align).

## 7. 진행 상태 (게이트 기준)
- AC-0(진단): ✅ 완료 (491fb780)
- AC-1(테이블 마이그): ✅ 설계·dry-run 통과·DDL-diff 요청(14c2e7d0). **DB 미적용(HOLD 준수)** → 배포는 (b) clear 후 supervisor DDL-diff GO 시 dev-foot 직접 pg 적용.
- AC-3(sync): 📝 **본 설계문서**(design-only). EF 구현·배포 = (b) clear 후.
- AC-2(read-swap): ⏸ AC-3 live 동시/후 (단독 금지).
- 게이트 (b) AUTOASSIGN-RUN-FAIL-TABSCROLL 현장 confirm done → 미도달. **code HOLD 유지**.
