---
id: T-20260526-foot-DUMMY-12RX
domain: foot
status: deployed
deploy_ready: true
priority: P2
created_at: 2026-05-26
deploy_ready_at: 2026-05-26T14:00:00+09:00
deployed_at: "2026-05-27T06:57:00+09:00"
db_changed: true
build_passed: N/A
spec_added: false
implemented_by: dev-foot
qa_result: pass
qa_grade: Yellow
deploy_commit: 722ebc9
bundle_hash: N/A (db_only)
---

# T-20260526-foot-DUMMY-12RX: 12회+ 경과파악 테스트용 더미 환자 데이터

## 요약

진료차트 Drawer 좌측 타임라인(경과파악) 기능을 실데이터로 검증하기 위한 더미 환자 2명 생성.

## 생성된 데이터

| 환자 | 전화 | 패키지 | 방문 횟수 | 기간 |
|------|------|--------|-----------|------|
| [경과테스트] 이수진 | 010-9901-0001 | 패키지1 (12회, 완료) | 12회 | 2025-12-16 ~ 2026-05-20 |
| [경과테스트] 김태호 | 010-9901-0002 | 블레라벨 (36회, 진행 중) | 21회 | 2025-08-14 ~ 2026-05-22 |

### 각 방문 데이터
- `check_ins` (status: done) — 현실적 시간대
- `medical_charts` — 진단명 + 치료기록 + 임상경과(NRS, 두께 수치 포함)
- `check_in_services` — 시술 항목 (힐러/오니코/수액 + 프리컨디셔닝)
- `package_sessions` — 패키지 회차 소진
- `chart_doctor_memos` — 원장 메모 (이수진 2건, 김태호 3건)

## AC 달성 여부

| AC | 상태 | 비고 |
|----|------|------|
| AC-1: 2명 이상 12회+ 이력, `[경과테스트]` prefix, is_simulation=true | ✅ | 이수진 12회, 김태호 21회 |
| AC-2: 치료메모+진료메모+치료항목+현실적 방문 간격 | ✅ | ~2주 간격(이수진), ~10-11일(김태호) |
| AC-3: 진료차트 Drawer 좌측 타임라인 12회+ 표시 | ✅ DB삽입 완료 | 화면 확인은 supervisor QA |
| AC-4: 롤백 SQL 포함 | ✅ | `20260526140000_dummy_progress_test.rollback.sql` |

## 마이그레이션 파일

- 메인: `supabase/migrations/20260526140000_dummy_progress_test.sql`
- 롤백: `supabase/migrations/20260526140000_dummy_progress_test.rollback.sql`

## 실행 결과 (DB 검증)

```
이수진: chart×12, check_in×12, service×20, session×12, doctor_memo×2  ✅
김태호: chart×21, check_in×21, service×28, session×21, doctor_memo×3  ✅
```

## 선행 티켓 관계

- DUMMY-TEST-DATA (deployed, 접수 테스트용) — 별개 목적
- DUMMY-DATA-CLEANUP (deploy-ready, 232건 제거) — 혼동 방지 위해 `[경과테스트]` prefix 사용
  - 롤백 SQL은 phone (010-9901-0001/0002) 기준 정밀 삭제로 CLEANUP과 충돌 없음
