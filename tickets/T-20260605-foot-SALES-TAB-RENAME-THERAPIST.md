---
id: T-20260605-foot-SALES-TAB-RENAME-THERAPIST
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build: pass
db_change: false
spec_added: true
commit: aa04222
risk: GO (0/5)
created_at: 2026-06-05
updated_at: 2026-06-05
---

# T-20260605-foot-SALES-TAB-RENAME-THERAPIST — 매출집계 "담당직원별" → "담당치료사별"

## 개요
직전 T-20260605-foot-SALES-STAFF-DEDUCT-BASIS에서 탭5(SalesStaffTab) 매출 귀속
기준을 '수납 직원' → '차감 치료사'로 전환. 귀속 주체가 치료사로 바뀌었으므로
화면 레이블을 정비한다. **표기만 변경, 집계 로직·데이터·컬럼 비변경.**

요청: 김주연 총괄 (C0ATE5P6JTH) / planner NEW-TASK MSG-20260605-153342-04un

## AC 처리
- AC-1 ✅ 탭/메뉴명 "담당직원별" → "담당치료사별" (Sales.tsx SALES_TABS label)
- AC-2 ✅ 노출 전위치 일괄 변경:
  - 탭 라벨 (Sales.tsx L57)
  - 엑셀 export 컬럼 헤더 L '담당직원' → '담당치료사' (salesExport.ts
    SALES_EXCEL_HEADERS + SalesExcelRow 키 + Sales.tsx row builder 2곳 동기화)
  - 차감기준 빈상태 안내문구 (SalesStaffTab.tsx L454)
  - 시트명 = '매출집계'(page 레벨)·파일명 '매출집계_*' → 변경 불요(해당 문자열 없음)
- AC-3 ✅ 내부 식별자 비변경: 컴포넌트(SalesStaffTab)·탭 value('staff')·파일명·
  data-testid(sales-staff-*) 전부 유지. 사용자 노출 텍스트만 교체.
- AC-4 ✅ 집계 로직·데이터·컬럼 순서 비변경(엑셀 25컬럼 A~Y 순서/매핑 동일,
  therapist??consultant fallback 로직 유지). 표기만.

## 주의 준수
- '담당직원' grep → 매출집계 컨텍스트(Sales.tsx/salesExport.ts/SalesStaffTab.tsx)
  한정 교체. 계정/직원관리 등 타 화면 '직원' 단어 미변경(grep 검증 0건 잔존).

## 검증
- `npm run build` PASS (✓ 3.42s)
- E2E spec 신규: tests/e2e/T-20260605-foot-SALES-TAB-RENAME-THERAPIST.spec.ts
  - S1 탭 라벨 '담당치료사별' 노출 + 구 '담당직원별' 미노출 + 탭 활성
  - S2 엑셀 export 헤더 '담당치료사' 존재 + '담당직원' 부재(빈데이터 시 skip-log)
- 회귀 정비: T-20260605-foot-SALES-STAFF-DEDUCT-BASIS.spec.ts 탭명 참조 2곳 갱신
- commit aa04222 (608ecc3..aa04222 origin/main), Vercel 자동배포
- 검증 URL: https://obliv-foot-crm.vercel.app/admin/sales

## supervisor 확인 권장
- 매출집계 페이지 탭 라벨 '담당치료사별' 시각 확인
- 엑셀 다운로드 → L열 헤더 '담당치료사' 확인 (데이터 존재 시)
