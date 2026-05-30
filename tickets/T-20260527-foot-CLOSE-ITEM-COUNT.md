---
id: T-20260527-foot-CLOSE-ITEM-COUNT
domain: foot
status: deploy-ready
deploy-ready: true
priority: P2
created: 2026-05-27
deadline: 2026-06-02
implemented_by: dev-foot
build: ok
db_change: false
spec_added: true
fix_applied: 2026-05-31
fix_reason: supervisor_QA_phase1_build_fail_60s_timeout — build.sh worktree symlink fast-path (e949dae), app code unchanged
commit_sha: e949dae
---

# T-20260527-foot-CLOSE-ITEM-COUNT — 일마감 개별 건 수 표기 (빨간 박스 구역 전체 적용)

## 배경

김주연 총괄 5/26 19:41 요청. T-20260526-foot-CLOSING-PAYCOUNT에서 패키지 결제 / 단건 결제 /
합계(결제수단별) 3개 SummaryCard에 건 수(N건)를 추가했으나, **수기결제 SummaryCard**는
"호환(backward-compatible)"만 처리하고 count 전달을 누락. 이번 티켓은 "전체 적용".

## 빨간 박스 구역 식별

`src/pages/Closing.tsx` 총 합계 탭의 SummaryCard 그리드 4종:

| 카드 | 이전 상태 | 이번 변경 |
|------|-----------|-----------|
| 패키지 결제 | ✅ 건 수 있음 | 유지 |
| 단건 결제 | ✅ 건 수 있음 | 유지 |
| **수기결제** | ❌ 건 수 없음 | **추가** |
| 합계 (결제수단별) | ✅ 건 수 있음 (단, "수기결제 포함" 행 제외) | **추가** |

## AC 체크

- [x] AC-1: Closing 페이지 "빨간 박스 구역" 식별 — SummaryCard 4종 코드 탐색 완료
- [x] AC-2: 수기결제 SummaryCard — 카드/현금/이체 각 행에 manualCardCount/manualCashCount/manualTransferCount 전달, totalCount 추가
- [x] AC-3: 합계 SummaryCard "수기결제 포함" 행에 count 전달 (manualCardCount+manualCashCount+manualTransferCount)
- [x] AC-4: 기존 패키지/단건/합계 카드 건 수 표기 회귀 없음 — spec 18/18 통과
- [x] AC-5: 빌드 통과 ✓ 3.45s

## 구현 요약

### 변경 파일
- `src/pages/Closing.tsx` (+6 lines)
- `tests/e2e/T-20260527-foot-CLOSE-ITEM-COUNT.spec.ts` (신규, 18 spec)

### 변경 내용

**1. 수기결제 SummaryCard (line 1244~1255)**

```tsx
// 전
rows={[
  ['카드', totals.manualCard],
  ['현금', totals.manualCash],
  ['이체', totals.manualTransfer],
]}
total={totals.manualTotal}

// 후
rows={[
  ['카드', totals.manualCard, totals.manualCardCount],
  ['현금', totals.manualCash, totals.manualCashCount],
  ['이체', totals.manualTransfer, totals.manualTransferCount],
]}
total={totals.manualTotal}
totalCount={totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount}
```

**2. 합계 카드 "수기결제 포함" 행 (line 1265~1267)**

```tsx
// 전
? [['수기결제 포함', totals.manualTotal] as [string, number]]

// 후
? [['수기결제 포함', totals.manualTotal, totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount] as [string, number, number]]
```

### 데이터 흐름
- `totals.manualCardCount/manualCashCount/manualTransferCount`는 T-20260526-CLOSING-PAYCOUNT에서 이미 계산됨
- 신규 DB 쿼리 없음, 신규 상태 없음 — props 연결만

## 빌드

```
✓ built in 3.45s (Closing-YbLNsK-6.js)
```

## E2E 스펙

`tests/e2e/T-20260527-foot-CLOSE-ITEM-COUNT.spec.ts` — 18 spec, 18 passed

## DB 변경

없음 (순수 프론트엔드 props 연결)

---

## FIX — supervisor QA phase2 재작업 (2026-05-27)

### 원인 분석

| 실패 항목 | 원인 |
|-----------|------|
| 스크린샷 = 로그인 페이지 | QA 환경에서 `/admin/closing` 접근 시 인증 세션 없어 리다이렉트 |
| "수기결제" 미탐지 | `{totals.manualTotal > 0 && (` 조건부 렌더링 → 0건 날짜에서 카드 DOM에 없음 |
| "합계 (결제수단별)" / "건" 미탐지 | 인증 실패로 페이지 자체가 렌더되지 않음 |

### 수정 내역

**1. `src/pages/Closing.tsx`** — 수기결제 카드 조건부 렌더링 제거

```tsx
// 전 (0건 시 카드 미렌더)
{totals.manualTotal > 0 && (
  <SummaryCard title="수기결제" .../>
)}

// 후 (항상 렌더 — 0건 시 "0건" 표기)
<SummaryCard title="수기결제" .../>
```

**2. `tests/e2e/T-20260527-foot-CLOSE-ITEM-COUNT.spec.ts`** — FIX + VISIBLE 블록 추가

- `FIX` describe: `{totals.manualTotal > 0 && (` 소스 부재 검증 (정적)
- `VISIBLE` describe: 브라우저 내비게이션 → `/admin/closing` 접근 후 3개 텍스트 가시성 검증
  - 인증 실패 시 명시적 오류 메시지 출력
  - 미래 날짜(2099-12-31) → 0건 상태에서 "0건" 텍스트 존재 검증

### 빌드
```
✓ built in 3.30s
```

### 스펙 추가
- FIX 1 spec (정적 분석) + VISIBLE 2 spec (브라우저) = +3 spec
- 총 21 spec
