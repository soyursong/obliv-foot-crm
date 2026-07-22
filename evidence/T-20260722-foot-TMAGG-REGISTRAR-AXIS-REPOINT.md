# T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT — verify-first 진단 + repoint evidence

DA 근거: scalp2 registrar_name CONSULT-REPLY §963⑩(a) — TmAggregateSection 은 foot-상속 shipped 코드,
foot 에도 동일 위반 개연. 본 티켓 = scalp2 Phase 0(TMAGG-REGISTRAR-AXIS-REPOINT)의 foot 전파.
게이트: FE read-path·no-DDL → 대표게이트 면제, supervisor DDL-diff only. **db_change: false**.

## 1. VERIFY-FIRST — 소스 진단 (위반 확정)

TmAggregateSection.tsx (repoint 전) 은 registrar_name 을 아래 2축으로 read 했다:

- **grouping key**: `tmStats` 가 `labelForRes(r)` 로 병합 → `tmCounselorLabel(created_by, source_system, staffName, registrar_name)`.
  created_by NULL/미매칭 & registrar_name 존재 시 grouping key = `registrar_name` (stats.ts: `if (rn) return rn;`). → **§963⑩(a) grouping key 위반.**
- **"TM팀만" 필터 inclusion 판정축**: `isTmLabel(labelForRes(r))` — 표시 라벨(=registrar_name 포함) 이 role='tm' 이름집합에 들면 inclusion.
  → **§963⑩(a) 필터 inclusion 판정축 위반.**

주석은 "registrar_name = 표시 전용, 집계 귀속 승격 금지" 라 선언했으나 **실제 코드는 grouping/filter 축으로 승격** — silent 위반.

## 2. VERIFY-FIRST — 라이브 실측 (위반 규모 확정)

`scripts/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT_diag.mjs` (READ-ONLY, prod rxlomoozakkjesdqjtvd, 60일 window):

```
reservations_scanned        : 687
created_by_resolved         : 210
created_by_null_or_unmatched: 477
regname_drives_grouping     : 374   ← registrar_name 이 실제 grouping key 로 작동
regname_drives_tmfilter     : 354   ← registrar_name 이 "TM팀만" inclusion 을 좌우
dopamine_total              : 362
dopamine_with_regname       : 362
tm_role_names               : [진운선, 이수빈, 김효신]
regname_grouping_buckets    : { 이수빈:121, 진운선:120, 김효신:113, 테스트시드:12,
                                [도파민TM] 박민지:7, [도파민TM] 김수진:1 }
```

→ **무위반 아님.** 687건 중 374건이 registrar_name 으로 grouping, 354건이 registrar_name 으로 "TM팀만"
inclusion 되고 있었음. 강제 코드변경 사유 성립 → repoint 진행(gap≠0).

## 3. FIX — 정규 귀속키 repoint

정규 귀속키 = `reservations.created_by` (→ user_profiles). registrar_name **무접촉**.

- **grouping key** (`src/lib/stats.ts` 신규 `tmAttributionKey(createdBy, sourceSystem, staffName)`):
  (1) created_by resolve → 직원명 / (2) 미해소 + dopamine → 단일 버킷 `'도파민 등록'` / (3) 그 외 → `'미지정'`.
  registrarName 파라미터 **없음** → 구조적 inert.
- **"TM팀만" 필터** (`TmAggregateSection.tsx` 신규 `isTmRes`/`isTmCheckIn`): `created_by → user_profiles.role === 'tm'` 직접 판정. registrar_name/name-set 무접촉.
- **registrar_name = label-only**: 드릴다운 '등록자(예약)' 열 + CSV 에서만 표시(`tmCounselorLabel` = 라벨 헬퍼). count/grouping/filter 무영향.
- 집계 헤더/드릴다운 열 'TM 상담사 (등록자)' → '(귀속)' 명칭 정정 + 도파민 버킷 각주 추가.

기존 grouping/filter 심볼(`labelForRes`/`labelForCheckIn`/`tmRoleNames`/`isTmLabel`) 은 컴포넌트에서 제거.

## 4. 검증

- `npx tsc --noEmit` exit 0 · `npm run build` ✓ built in ~5.4s.
- 신규 spec `tests/e2e/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT.spec.ts` — 11 green:
  - A. 정적 소스 불변식(축 repoint + registrar_name 무접촉) 7건.
  - B. 집계-inert 수치 시뮬(registrar_name 편집→count 불변 + 도파민 단일버킷 + TM inclusion=created_by role) 3건 + setup.
- 무회귀: 기존 TM집계 spec 재실행. 헤더 명칭 정정('등록자'→'귀속')으로 인한 stale 라이브 assertion 2건
  (DOPAMINE-REGISTRANT / FOOTSTATS-COUNSELOR-NULL) 을 신 invariant 텍스트로 reconcile. 전체 green.

## 5. 게이트/DB

- **DDL 0 · migration 0 · RPC 0 · write 0**. 신규 컬럼·테이블·enum 없음 → §S2.4 data-architect CONSULT 게이트 비대상.
- FE read-path only → 대표게이트 면제. supervisor DDL-diff only(diff 없음).
- 백필(scalp2 Phase 0/1/2)과 무관 — foot 는 203건 백필 대상 아님, 독립 read-side repoint.
