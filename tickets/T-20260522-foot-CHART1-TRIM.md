---
id: T-20260522-foot-CHART1-TRIM
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
e2e_spec: true
summary: "1번차트 불필요 항목 제거(AC-1/2/6/7/9/10) + 금일 동선 표기 보정(AC-3/4)"
---

## T-20260522-foot-CHART1-TRIM — 1번차트 불필요 항목 제거 + 금일 동선 표기 보정

**P2 | FE-only**

### AC 완료 내역

- AC-1: "패키지 잔여회차" 항목 제거 ✅ (ActivePackageSummary 컴포넌트 삭제)
- AC-2: "체크리스트" / "비급여동의서" 항목 제거 ✅
- AC-3: 공간배정 드롭다운 완전 제거 → [금일 동선] 항상 표시 통합 ✅
- AC-4: [금일 동선] 치료실/레이저실 항상 표기 ✅ (logs 없는 슬롯 "—" placeholder)
- AC-6: "원장 소견" 섹션 완전 제거 ✅ (DB 기존 데이터 보존, FE 비노출)
- AC-7: "진료 기록" 섹션 완전 제거 ✅ (담당실장·치료구분·치료내용·레이저시간·비가열타이머·메모, DB 보존)
- AC-9: 하단구역 KOH균검사 항목 제거 ✅ (Chart1StorageSection prefix=koh-results 제거, DB 보존)
- AC-10: 하단구역 경과분석지 항목 제거 ✅ (Chart1StorageSection prefix=progress 제거, DB 보존)
- AC-11: 회귀 없음 ✅ (S-4 spec 종합 검증)

### 변경 파일

- `src/components/CheckInDetailSheet.tsx`
  - Chart1StorageSection 함수 정의 제거 (dead code — KOH·progress 양 호출 제거됨)
  - KOH균검사 JSX 렌더 블록 제거 (AC-9)
  - 경과분석지 JSX 렌더 블록 제거 (AC-10)
  - 원장소견 섹션 제거 (AC-6, 이전 커밋)
  - 진료기록 섹션 제거 (AC-7, 이전 커밋)
- `tests/e2e/T-20260522-foot-CHART1-TRIM.spec.ts`
  - S-3: 하단 쌍방연동 영역 KOH균검사·경과분석지 미존재 확인 (AC-9/10)
  - S-4: 회귀 없음 — 제거 7항목 종합 확인 (AC-11)

### 빌드 결과

- `npm run build` → ✅ 3.29s
- DB 변경: 없음
- 비즈로직 접점: 치료구분·치료내용 입력 경로 삭제 (인지됨)
