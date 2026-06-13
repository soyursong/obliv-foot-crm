---
ticket_id: T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-14
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (2/5)
commit_sha: 2430bca
---

## 요청

원천: NEW-TASK MSG-20260613-235629-lbbv (planner, P2). 김주연 총괄 요청.
고객관리 화면 개선 — 고객 다중선택 + 리스트 내보내기.
행별 체크박스+전체선택 → "내보내기" 버튼 → 선택 고객(선택0건이면 필터된 전체) CSV 다운로드.

⚠️ PII 가드 의무:
- 내보내기 컬럼에 rrn(주민번호) 포함 금지 (제외).
- 전화/생년월일 PII 포함 → admin/manager 권한만 내보내기 노출·실행(게이팅).
- 1차 CSV(무의존), 엑셀은 후속.

## 구현

기존 5FIX AC4(xlsx 내보내기)를 supersede → 1차 CSV(무의존) + PII 게이팅 강화.
(체크박스·전체선택 UI는 5FIX AC4에서 旣구현 → 재사용. 본 티켓은 ① CSV 전환 ② 권한 게이팅 ③ 선택0건→필터전체 3축 추가)

### 신규 — src/lib/customerCsv.ts (무의존)
- `downloadCustomerCsv(rows, filename)` — Blob + URL.createObjectURL, UTF-8 BOM(Excel 한글 호환). xlsx 등 외부 의존 없음.
- `buildCustomerCsv` — CSV 이스케이프(콤마·따옴표·개행), CRLF.
- `CUSTOMER_CSV_HEADERS` = 이름·전화번호·생년월일·차트번호·방문횟수·최종방문·결제액·고객메모.
  ★rrn(주민번호) 헤더에 부재 → 어떤 권한이든 export 컬럼에서 영구 제외.★
- 엑셀(.xlsx)은 customerExport.ts 유지(후속 티켓용).

### permissions.ts
- PermKey `customer_export` 추가 = `['admin', 'manager']`.
- register(이미 admin/manager)와 동일 최소권한 패턴.

### src/pages/Customers.tsx
- `canExportCustomers = canAccess(role, 'customer_export')` — 버튼 **노출** 게이팅 + handleExport 진입 **실행** 게이팅(이중 방어).
- handleExport:
  - 선택 >0 → 선택된 행(현재 페이지)만 CSV.
  - 선택 0건 → 현재 필터(검색어+담당자)에 매칭되는 **전체** 재조회(페이지네이션 없이 range 0~EXPORT_MAX-1) 후 CSV.
  - 생년월일은 서버 파생(fn_customer_birthdates)만 사용 → rrn 평문 미노출.
- 공유 헬퍼 추출(중복/drift 차단):
  - `applyCustomerSearchFilters` — runSearch·export 동일 필터 보장.
  - `loadCustomerStats` — 방문·결제·패키지·생년월일 로드, IN 쿼리 STATS_CHUNK(150) 청크(URL 한계 회피).
- 버튼 라벨 '내려받기'→'내보내기', 진행 중 '내보내는 중…' + disabled(중복 클릭 방지).

## 검증

- `npm run build` ✅ (tsc 타입체크 포함, 에러 0)
- E2E spec 신규: tests/e2e/T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT.spec.ts
  - AC-1 체크박스/전체선택/카운트 라벨, AC-2 CSV(.csv) 다운로드, AC-3 선택0건→전체 재조회(range), AC-4 admin 노출, AC-5 회귀.
- 회귀: 5FIX spec S1/S3 xlsx→csv·내려받기→내보내기로 갱신(supersede 정합).

## PII / 데이터 정책

- 신규 컬럼·테이블·enum 추가 없음 → data-architect CONSULT 불요.
- rrn 평문/뒷자리 export 컬럼 영구 부재. 생년월일=서버 파생 YYYY-MM-DD만.
- 내보내기 노출·실행 admin/manager 한정(PERM_MATRIX SSOT).

## 비고 (FOLLOWUP 후보)

- 비-admin(staff) 음성 케이스 E2E는 역할 전환 로그인 인프라 부재로 미포함 → 게이팅은 permissions.ts SSOT + 핸들러 이중가드로 강제.
- 엑셀(.xlsx) 내보내기 = 후속 티켓(customerExport.ts 유지).
- 선택0건 전체 export 안전상한 EXPORT_MAX=5000(단일 지점 현실 규모 충분, 초과 시 토스트 고지).
