---
id: T-20260522-foot-CLINIC-JONGNO-ORIGIN
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
qa_grade: null
deployed_at: null
deploy_commit: 0352f50
bundle_hash: null
hotfix: false
created: 2026-05-22
deadline: 2026-05-26
deploy_ready_at: 2026-05-23
deploy_ready_by: dev-foot
build_ok: true
db_changed: false
db_migration: supabase/migrations/20260523020000_verify_jongno_foot_clinic.sql
e2e_spec: null
e2e_spec_exempt_reason: db_only
slack_channel: null
slack_thread_ts: null
reporter: planner
reporter_slack_id: null
attachments: []
risk_verdict: GO
risk_reason: "DB INSERT ON CONFLICT DO NOTHING 1건 — 스키마 변경 없음. 이미 존재하는 레코드엔 no-op. 롱레 DB origin 클리닉은 dev-crm이 soft-delete 완료(deleted_at 설정). 전체 위험 0/5."
---

# T-20260522-foot-CLINIC-JONGNO-ORIGIN — 종로 오리진점 풋센터 DB 등록

## 배경

2026-05-22 commit 9f4ea6c 작업 중 종로 오리진점 slug(`jongno-foot`)가 롱레 DB(muvcfrgmxlwtidundlre)에
잘못 등록됨. 풋 Supabase(rxlomoozakkjesdqjtvd)에 올바르게 등록되어 있는지 확인 + 롱레 DB 정리.

## 수용 기준 (AC) — 처리 결과

### AC-1 ✅ — 풋 DB clinics INSERT 확인
- 풋 Supabase(rxlomoozakkjesdqjtvd) clinics 테이블에 `jongno-foot` 레코드 이미 존재 확인
  - `id`: 74967aea-a60b-4da3-a0e7-9c997a930bc8
  - `slug`: jongno-foot
  - `name`: 오블리브의원 서울 오리진점 (의료기관 공식 명칭)
  - `consultation_rooms`: 5, `treatment_rooms`: 10, `laser_rooms`: 12
  - `address`: 서울 종구 청계천로 93 5층
- idempotent migration(`ON CONFLICT DO NOTHING`) 추가:
  `supabase/migrations/20260523020000_verify_jongno_foot_clinic.sql`
- 초기 seed(20260419000002_seed_data.sql)부터 존재하는 핵심 레코드 — INSERT는 no-op

### AC-2 ✅ — env FOOT_ORIGIN_SLUG 갱신
- `.env`: `FOOT_ORIGIN_SLUG=jongno-foot` 추가 완료
- `.gitignore` 대상이므로 **Vercel 환경변수 별도 설정 필요**
  - Vercel → obliv-foot-crm → Settings → Environment Variables → `FOOT_ORIGIN_SLUG=jongno-foot`

### AC-3 ✅ — 롱레 DB 잘못 등록된 origin 클리닉 정리
- 롱레 DB(muvcfrgmxlwtidundlre) 확인 결과:
  - `jongno-foot` 슬러그: **미등록** (clean, 삭제 불필요)
  - `origin` 슬러그 (오리진점, 2026-05-22T10:20 생성): 잘못 등록된 레코드
    - `id`: 9e2b048c-4d2b-4734-956a-6a04298a395c
    - 연결 데이터(customers/check_ins): **0건** — 삭제 안전
    - **dev-crm(T-20260523-crm-ORIGIN-SOFTDEL)이 soft-delete 완료**
      - `deleted_at`: 2026-05-23T05:17:32.35252+00:00
      - CEO 직접 지시 — 오리진점 soft-delete(종로 롱래스팅센터 통합)

### AC-4 ✅ — T-20260522-foot-SELFCHECKIN-UX 블로커 해소
- 풋 DB에 `jongno-foot` slug 존재 확인 → SELFCHECKIN-UX 블로커(slug 미등록) 해소
- SELFCHECKIN-UX 티켓 진행 가능

## 구현 내역

### DB 변경
- **없음** (스키마 변경 없음)
- migration 파일 추가 (idempotent, 운영 DB no-op):
  - `supabase/migrations/20260523020000_verify_jongno_foot_clinic.sql`
  - `supabase/migrations/20260523020000_verify_jongno_foot_clinic.down.sql`

### FE 변경
- **없음** (db_only 티켓)

### E2E 스펙
- **면제** (e2e_spec_exempt_reason: db_only)

## 빌드 결과
- 코드 변경 없음 — 빌드 독립적으로 통과 확인 (기준: commit 0352f50)
- DB 마이그레이션: 풋 DB no-op (이미 존재)

## 관련 티켓
- T-20260521-foot-CLINIC-INFO-SYNC (closed) — 병원정보(전화·팩스·사업자번호) 등록
- T-20260523-crm-ORIGIN-SOFTDEL (closed, dev-crm) — 롱레 DB origin 클리닉 soft-delete
- T-20260522-foot-SELFCHECKIN-UX — 블로커 해소 (이 티켓 완료로 진행 가능)

## 주의사항

**Vercel env 추가 필요**: `FOOT_ORIGIN_SLUG=jongno-foot`
- `.env`는 gitignored — commit에 포함되지 않음
- Vercel 프로젝트 설정에서 수동 추가 필요
