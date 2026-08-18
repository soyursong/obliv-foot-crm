# T-20260818-foot-NEWRESV-CUSTOMER-CREATE-STATEMENT-TIMEOUT — 진단 (evidence-based, read-only)

작성: dev-foot / 2026-08-18 (KST 15:3x)
prod ref: rxlomoozakkjesdqjtvd / 접속: Supabase Management API `/database/query` (postgres role, read-only 진단)

## 결론
**근본원인 = DB compute 포화 (storage.search 폭주), NOT customers INSERT/index 문제.**
= shared-infra. 자매 T-20260818-foot-CRM-SAVE-FAIL-LOADING-SLOW-OUTAGE(12:48 CRM 전반 저장실패·로딩지연)와 동일 축.

## 증거

### 1. customers 경로는 무결 (범인 아님)
- customers: est_rows=2355, total_size=2256 kB (매우 작음)
- 인덱스: `idx_customers_clinic_phone` UNIQUE(clinic_id, phone) 존재 → 선행 SELECT·중복검사 fast
- BEFORE INSERT 트리거 존재(assign_foot_customer_chart_number 등)나 테이블 2355행이라 무시가능
- 락 대기 없음: pg_stat_activity 에서 wait_event_type='Lock' 0건 → 락 경합 아님

### 2. storage.search 가 압도적 DB 소비자 (pg_stat_statements)
| query | calls | total_exec_s | mean_ms |
|---|---|---|---|
| **storage.search($1..$8)** | **3,550,842** | **1,646,326** | **463.6** |
| customers select | 2,533,927 | 214,230 | 84.5 |
| check_in_services | 505,535 | 108,081 | 213.8 |
- storage.search 총 DB시간 = 2위(customers)의 **7.7배**. 평균 464ms/call.

### 3. 인시던트 시점 라이브 부하
- active 쿼리 breakdown: storage.search 10개 동시(최대 9s), 나머지는 짧음
- customers SELECT 1건이 6.9s 소요(테이블 2355행인데) = DB가 compute starved 임을 방증

### 4. storage.objects 는 정상
- 16MB / 10,385 rows, 인덱스 정상(name_prefix_search, bucketid_objname, idx_objects_bucket_id_name(_lower))
- 버킷: photos=10,890, foot-health-q-photos=198, documents=34, signatures=12, message-images=4
- 8.7h 장기쿼리 = realtime replication slot(정상), LISTEN pgrst 120d(정상) → 스턱 트랜잭션 아님

## 인과 사슬
storage.search 호출 폭주 + call당 464ms → DB compute(CPU/IO) 포화 → 모든 쿼리 지연
→ authenticated role statement_timeout(기본 8s) 초과 → customers INSERT 취소
→ FE "고객 생성 실패: canceling statement due to statement timeout"
(postgres role 은 2min 이라 관리쿼리는 통과 — client authenticated role 만 타임아웃)

## foot-side 기여 (진원)
foot FE 가 photos 버킷에 .list() 를 다수 화면에서 호출:
- CustomerChartPage(3), MedicalChartPanel(2), PenChartTab(2), InsuranceDocPanel, CheckInDetailSheet, PenChartAttachPanel, DocumentViewer(documents)
- 차트/펜차트/보험 패널 열 때마다 storage.list → storage.search. 동시 사용자 × 화면전환 = 폭주.

## 스코핑 판정
- 현재 라이브 P0(신환 예약 전면차단) 즉시해소 = infra(dev-meta): storage.search 부하 완화 / Supabase compute upsize / call driver 억제. **foot 레포 커밋으로 즉시 해소 불가.**
- customers 인덱스 누락 없음 → db_change/MIG-GATE 대상 아님.
- 지속(sustainable) 완화 = foot-side .list() 최적화(캐시 / DB manifest 로 파일목록 추적 → storage.list 제거). 별건 P1 follow-up 후보. hotfix 아님.
