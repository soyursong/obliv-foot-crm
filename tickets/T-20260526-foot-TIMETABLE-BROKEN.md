---
id: T-20260526-foot-TIMETABLE-BROKEN
domain: foot
priority: P1
status: deploy-ready
hotfix: true
created: 2026-05-26 05:42
deadline: 2026-05-26
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779626765.681149
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "운영 핵심 기능(통합시간표) 렌더링 완전 실패. FOLD V2(a8c0517) 혼입 + DUMMY-DATA-CLEANUP 232건 삭제 side effect 복합 의심. 비즈니스 로직 영향(1/5)."
source_msg: MSG-20260526-054038-56re
db_migration: false
build_passed: true
commit_sha: TBD
deploy_ready_at: 2026-05-26
e2e_spec: tests/e2e/T-20260526-foot-TIMETABLE-BROKEN.spec.ts
fix_summary: |
  root_cause: TIMETABLE-SCROLL(629aa8d)이 expandedSlot 초기값을 isToday?currentSlot:null로
  변경 → 마운트 시 현재 슬롯 자동 펼침 → 아코디언 accordion 렌더 중 JS 에러 →
  ChunkErrorBoundary 캐치 → Dashboard 전체 에러 UI로 교체됨.
  fix_1: expandedSlot 초기값 null 고정 (자동 펼침 제거) — AC-2 방안B
  fix_2: 아코디언 항목 null-safe (r?.customer_name ?? null) + try-catch
  fix_3: safeVisitType 가드 + chartMap?.get() null safety
  fold_v1: 유지 (AC-1~5 기능 회귀 없음)
related_tickets:
  - T-20260522-foot-TIMETABLE-FOLD
  - T-20260525-foot-UNREQ-BOTTOM-UI
  - T-20260524-foot-TIMETABLE-TIME-CONFIRM
---

# T-20260526-foot-TIMETABLE-BROKEN — 통합시간표 탭 안열림 긴급 수정

## 배경

김주연 총괄(풋센터): **"@장쳰 통합시간표 안열림 이슈"** — 통합시간표 탭 자체가 안 열리는 상황.

### 타임라인

| 일시 | 사건 |
|------|------|
| 5/22 18:31 | TIMETABLE-FOLD V2(a8c0517) main commit — deploy-ready(supervisor QA 전) |
| 5/24 21:10 | TIMETABLE-TIME-CONFIRM(43c4541→40bfca7) 배포 — FOLD V2 코드 함께 Vercel 배포 |
| 5/25 17:48 | 김주연 총괄 "하단에 요청 안 한 명단(초진/재진) 뜬다" → UNREQ-BOTTOM-UI 조사 |
| 5/25 18:44 | 조사 완료 — FOLD V2 AC-7(아코디언 명단) + DUMMY-TEST-DATA 232건 노출 확정 |
| 5/25 ~ | 장쳰 "FOLD 코드가 함께 올라간 것 같다" 파악 → dev-foot 확인 약속 |
| 5/25 ~ | DUMMY-DATA-CLEANUP 실행 (232건 삭제) |
| **5/26 05:40** | **김주연 총괄 "통합시간표 안열림 이슈" — 탭 자체가 안 열림으로 악화** |

### 원인 후보

1. **TIMETABLE-FOLD V2 코드(a8c0517) JS 에러**: AC-7 아코디언 렌더링 코드에서 예외 발생 → Dashboard.tsx 전체 통합시간표 영역 unmount. FOLD V2는 deploy-ready(supervisor QA 미경유)인데 main에 혼입됨.
2. **DUMMY-DATA-CLEANUP side effect**: 232건 삭제 후 FOLD V2 코드가 참조하던 데이터가 사라져 null reference → 렌더 실패.
3. **복합**: FOLD V2 코드 + 데이터 삭제 조합으로 JS 런타임 에러 → 시간표 탭 전체 크래시.

## 수용 기준

### AC-1: 원인 특정 (즉시)
- 운영 사이트 대시보드 > 통합시간표 탭 접근하여 실제 에러 상태 확인
- 브라우저 콘솔 에러(JS exception) 캡처
- Dashboard.tsx 내 통합시간표 영역 렌더 실패 지점 특정
- FOLD V2(a8c0517) 코드가 현재 production 번들에 포함되어 있는지 확인 (`git log main --oneline | grep a8c0517`)

### AC-2: FOLD V2 코드 비활성화 또는 제거
- TIMETABLE-FOLD V2(AC-6 실시간 갱신 + AC-7 아코디언 명단) 코드가 원인이면:
  - **방안 A (권장)**: FOLD V2 AC-6/AC-7 코드를 feature flag로 비활성화 또는 revert
  - **방안 B**: 에러 원인 코드만 null-safe 처리 (데이터 없으면 빈 상태 표시)
- FOLD V1(접기/펼치기 토글, AC-1~5)은 유지 가능하면 유지
- **핵심**: 통합시간표 탭이 정상 렌더되어야 함

### AC-3: DUMMY-DATA-CLEANUP 연관 확인
- 232건 삭제 후 side effect 여부 확인 (reservations/customers 참조 무결성)
- 5/26 DUMMY-DATA-GEN(72건, db0ec66) 데이터와의 충돌 여부 확인

### AC-4: 통합시간표 정상 동작 복원 확인
- 수정 후 대시보드 > 통합시간표 탭 클릭 → 시간표 정상 렌더 확인
- 기존 예약 데이터 정상 표시 확인
- 시간 슬롯 클릭 → 예약 팝업 정상 노출 확인

### AC-5: 빌드 통과
- `npm run build` 에러 없이 완료

## 현장 클릭 시나리오 (E2E 변환 가이드)

### 시나리오 1: 통합시간표 탭 정상 열기
1. 로그인 → 대시보드 (/)
2. 통합시간표 탭 클릭
3. 시간표 그리드 정상 렌더 확인 (에러 화면/빈 화면 아님)
4. 시간 슬롯 표시 확인 (10:00, 10:30, 11:00...)

### 시나리오 2: 기존 기능 회귀 없음
1. 통합시간표 펼친 상태에서 접기(chevron) 클릭
2. 시간표 접힘 확인
3. 펼치기 클릭 → 시간표 복원 확인

### 시나리오 3: 예약 데이터 표시
1. 통합시간표에서 예약 있는 시간 슬롯 확인
2. 해당 슬롯 카운트 숫자 표시 확인
3. 테스트 더미 데이터(테스트초진XX/재진XX) 미표시 확인

## 리스크 5항목

| # | 항목 | 판정 |
|---|------|------|
| 1 | DB 스키마 변경 | N/A — 조사+FE 수정 |
| 2 | 외부 서비스 의존 | N/A |
| 3 | 비즈니스 로직 변경 | ⚠️ 핵심 대시보드 기능 복원 — 기존 동작으로 되돌리는 것이므로 위험 낮음 |
| 4 | 대량 데이터 변경 | N/A |
| 5 | 신규 npm 패키지 | N/A |

**verdict: GO_WARN (1/5 — 비즈니스 로직)**. 핵심 기능 장애 복원이므로 즉시 진행.

## 비고
- **hotfix 분류** — 운영 핵심 기능 장애. deadline 당일(5/26).
- FOLD V2 티켓(T-20260522-foot-TIMETABLE-FOLD)은 별도 유지. 본 티켓은 **장애 복원**에 집중.
- 수정 후 supervisor QA 경유하여 배포.
- 김주연 총괄 현장 확인 후 pm-confirm 예정.
