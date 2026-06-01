---
id: T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
created: 2026-06-01
updated: 2026-06-01
deadline: 2026-06-03
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS.spec.ts
commit: ad8493a
---

# T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS
## 직원.공간 > 공간배정 "마지막 저장 자동 연동" 리셋 회귀 복구

**요청자**: 김주연 총괄 (planner 경유)
**현상**: 6/1 공간배정이 리셋됨 — "마지막 저장 기준 자동 연동" 미동작

---

## 1. 원인 규명 — 표시/로직 회귀 (데이터 유실 아님)

조사 순서 #1 (데이터 잔존) 결과: **room_assignments 데이터 전부 생존.**

- 총 187 rows, 전부 정확한 clinic_id(`74967aea…930bc8`) 하에 존재.
- 5/24 풀 스냅샷 23 rooms 생존 (room_name C1~C10/L1~L12/상담실1~5/원장실 C5 — 현재 마스터와 정확 일치, 드리프트 없음).
- 6/1 rows 7건 존재, created_at 전부 동일(`2026-06-01T04:56:06.099263+00`) = 단일 배치 INSERT(Staff `handleSave`) = **부분(7-room) 저장**.
- 5/31 CF cutover 마이그레이션(`migrate_hfq_to_foot`)은 customers 한정·미실행 → room_assignments 무관. clinic_id 변경 없음.

→ **데이터 유실 아님 → blocked/ESCALATE 불필요.**

### 회귀 메커니즘
기존 읽기 로직(Staff.tsx `assignments`, Dashboard.tsx `fetchAssignments`)은
**"MAX(created_at) 날짜의 row만 로드"** 였다. 당일(today)에 부분 저장 또는 슬롯 단건
변경으로 today row가 **1건이라도** 생기면, 그 부분 스냅샷이 직전 풀 스냅샷(carry-over)을
**통째로 가려** 나머지 방이 "리셋"처럼 보였다.

실 사고: 6/1 부분 7-row 저장 → MAX(created_at)=6/1 → 5/24 풀 23-room carry-over가 가려짐 → 16개 방 미배정 표시.

> 이 결함은 잠재(latent)였고, 5/25 field_confirmed 당시엔 today 부분 row가 없어 노출되지 않았다.
> 6/1 부분 저장이 트리거.

## 2. 복구 — baseline + today 머지

읽기 = **baseline(today 이전 최신 날짜 스냅샷) + today** 를 room_name 기준 머지(today 우선).

- `src/pages/Staff.tsx` — `assignments` 쿼리: 머지 + `lastSavedDate` 라벨 재계산. queryKey에 todayStr 추가.
- `src/pages/Dashboard.tsx` — `fetchAssignments`: 동일 머지. carry-over 인디케이터는 당일 저장 0건일 때만 노출(기존 의미 유지).
- `handleSave`는 머지된 전체 effective 세트를 today로 저장 → 부분 today 스냅샷 재발 차단.

→ 당일 부분 저장이 있어도 나머지 방은 직전 풀 스냅샷이 carry-over 유지. 5/25 동작 복원.

## 3. 데이터 보존

- 읽기 머지만 수행. **어떤 row도 삭제/변경하지 않음.** 임의 SQL 미실행.
- 배포 후 현장 진입 시 5/24 풀(16 carry-over) + 6/1(7, C3=김성우·C9=서은정 등 의도 변경 우선) 머지로 전 방 복원 표시.

## AC 이행 결과

| AC | 내용 | 이행 |
|----|------|------|
| 원인 규명 | 표시회귀 vs 데이터유실 판별 | ✅ 표시/로직 회귀, 데이터 생존 확인 |
| 복구 | 5/25 carry-over 동작 복원 | ✅ baseline+today 머지 |
| 데이터 보존 | 무손실 | ✅ 읽기 머지만, SQL 무실행 |
| fallback 가드/테스트 | 부분 스냅샷 collapse 방지 + E2E | ✅ handleSave 풀 저장 + spec 3종 |
| DB 스키마 무변경 | | ✅ db-change=false |

## 검증
- 빌드 `tsc -b && vite build` ✅
- E2E spec: S1(carry-over 표시) / S2(부분 저장 후 비감소 가드) / S3(콘솔 에러 0)
- commit `ad8493a` push 완료 → Vercel 자동 배포

## 잔여/주의 (supervisor QA 참고)
- 의도적 단건 삭제(슬롯 staff null → today row delete) 시, 머지로 baseline이 다시 표시되는 코너케이스 존재. 현장 "배정 지속" 기대와 부합하나, 명시적 "해당 방 비우기" 흐름이 필요하면 별도 티켓 권고.
- 현장 클릭 시나리오 정본 2종(티켓 본문)이 MQ에 첨부 안 됨 → S1/S2로 합리적 도출. planner 시나리오 확정 시 spec 라벨 정합 검토 권고.
