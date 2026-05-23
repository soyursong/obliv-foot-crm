---
id: T-20260522-foot-FOOT-PKG-DEDUCT-BUG
domain: foot
priority: P0
status: deployed
hotfix: true
deploy-ready: true
fix_commit: 01ebfc3
resolved_by: T-20260522-foot-PKG-HEALER-DEDUCT
related: T-20260516-foot-HEALER-RESV-BTN
e2e_spec: tests/e2e/T-20260522-foot-FOOT-PKG-DEDUCT-BUG.spec.ts
db_change: false
created: 2026-05-22
deadline: 2026-05-22
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1779437454.843149"
risk_verdict: GO_WARN
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-22T18:26:43+09:00"
deploy_commit: 005f6ef
bundle_hash: CustomerChartPage-DUzqL-hj
field_soak_until: "2026-05-23T18:26:43+09:00"
field_validation_slack_ts: "1779442403.611919"
supervisor_qa_at: "2026-05-22T09:32:30Z"
supervisor_reverify_at: "2026-05-23T05:40:00Z"
---

# T-20260522-foot-FOOT-PKG-DEDUCT-BUG — 힐러 예약 후 패키지 회차 차감 미작동 (P0 hotfix)

## 증상 (접수)

- 2번차트 힐러 예약 생성 후 [힐러예약 후 차감] 버튼 클릭 시:
  - 당일 시술 차감: ✅ 정상
  - 패키지 티켓(회차) 차감: ❌ 미작동
- 반복 재현 확인 (김주연 총괄)

## 조사 결과

### 1단계 — HEALER-RESV-BTN v3 커버 여부

**결론: 커버 X — 별도 fix 필요**

| 항목 | 내용 |
|------|------|
| HEALER-RESV-BTN v3 변경 (7c1e9c3) | `handleHealerFlag()` 날짜 비교 `> today` → `>= today` (1줄) |
| 패키지 차감 포함 여부 | **없음** — 패키지 차감 코드 전혀 없음 |
| 결론 | HEALER-RESV-BTN v3는 당일 예약 healer_flag 미반영 버그만 수정; 패키지 회차 차감 버그와 독립 |

### 2단계 — Root cause

기존 `handleHealerFlag` 함수: **힐러 플래그 설정만** 수행.
[힐러예약 후 차감] 버튼이 `handleHealerFlag`만 호출 → `package_sessions.insert` 호출 없음 → 패키지 회차 차감 누락.

## Fix (commit 01ebfc3)

**`handleHealerDeduct` 복합 핸들러 신설** (`CustomerChartPage.tsx`):

```
[힐러예약 후 차감] 클릭
  ↓
  1. 프리체크 (치료사 선택 + 활성 패키지 존재 확인)
  ↓
  2. package_sessions.insert → 패키지 회차 차감
  ↓
  3. package_sessions 새로고침 → computeRemainingFromSessionRows → 잔여 회차 실시간 갱신
  ↓
  4. healer_flag ON (다음 예약 있음) 또는 pending_healer_flag ON (없음)
```

- 기존 `healerFlagLoading` 폐기 → `savingHealerDeduct` 통합
- 버튼 disabled 조건에 "활성 패키지 없음" 가드 추가

## AC 체크

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | 힐러 예약 시 패키지 회차 차감 정상 처리 | ✅ handleHealerDeduct step2 |
| AC-2 | 기존 당일 시술 차감([차감] 버튼) 회귀 없음 | ✅ saveC22Deduct 미변경 |
| AC-3 | 잔여 회차 표시 실시간 갱신 | ✅ step3 sessData 새로고침 |
| AC-4 | HEALER-RESV-BTN 관계 명확화 | ✅ 코드 주석 + 본 문서 |

## 관계

- **T-20260522-foot-PKG-HEALER-DEDUCT** (01ebfc3): 동일 이슈. 본 티켓이 planner MSG 수신 후 재추적. 동일 fix로 해결됨.
- **T-20260516-foot-HEALER-RESV-BTN** v3 (7c1e9c3+96e53b0): 날짜 비교 버그만 수정. 패키지 차감 미포함. 독립적.

---

## Supervisor QA 독립 검증 (2026-05-22T09:32Z)

**판정: GO — Yellow (GO_WARN)**

### QA 6항목

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ | npm run build 3.17s, exit 0 |
| 기존 기능 회귀 | ✅ | saveC22Deduct (line 2316) + onClick={saveC22Deduct} (line 4773) 미변경 |
| DB 호환 | ✅ | db_change: false. package_sessions 기존 스키마 재사용 |
| 권한·RLS | ✅ | DB 변경 없음. package_sessions insert는 기존 허용 권한 재사용 |
| 모바일 레이아웃 | ✅ | 기존 버튼 교체 (동일 위치·클래스 구조 유지) |
| 빌드 env 매트릭스 | ✅ | VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY grep 확인 |

### Runtime Safety Gate §7.5

- `for (const s of sessions)` — sessions = `(sessData ?? [])` null 가드 ✅
- `Object.values(used)` — `used = usedMap.get(p.id) ?? {}` null 가드 ✅
- `remainingArr[i] ?? prev[i]?.remaining ?? null` optional chaining ✅
- `(s.staff as { name: string } | null)?.name ?? null` optional chaining ✅
- 위험 패턴 검출 없음

### Cross-CRM Contract Gate

DB 변경 없음 → 해당 없음 (pass)

### 브라우저 시뮬레이션

- URL: https://obliv-foot-crm.vercel.app → /login 리다이렉트
- page_errors: 0, console_errors: 0, network_errors: 0 ✅
- White screen 없음 ✅

### 배포 확인

- origin/main push: 이미 완료 (commit 01ebfc3 포함)
- Vercel 자동 배포 트리거됨
- 슬랙 배포 알림: C0ATE5P6JTH, thread_ts=1779442403.611919, broadcast ✅

---

## Supervisor 재검증 (2026-05-23T05:40Z)

**목적**: 이전 세션 QA 독립 재확인 + bundle hash 갱신

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ | npm run build 3.62s, exit 0 (HEAD 35be317) |
| 운영 번들 hash | ✅ | CustomerChartPage-DUzqL-hj (로컬=운영 일치) |
| VITE env 매트릭스 | ✅ | SUPABASE_URL→rxlomoozakkjesdqjtvd 운영 bundle 확인 |
| Runtime Safety §7.5 | ✅ | packages/packageSessions `useState([])` init, sessData `?? []` 가드 |
| E2E spec | ✅ | 3 passed / 2 skipped (활성 카드 없음) — 18.0s |
| 브라우저 | ✅ | HTTP/2 200, 로그인 페이지 정상, white screen 없음 |
| fix 포함 여부 | ✅ | git merge-base --is-ancestor 01ebfc3 HEAD → IS in HEAD |

**재판정: GO — 기존 Yellow 유지**  
Field Soak 진행 중 (`field_soak_until: 2026-05-23T18:26:43+09:00`)
