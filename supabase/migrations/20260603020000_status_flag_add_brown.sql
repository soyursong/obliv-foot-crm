-- T-20260603-foot-STATUSFLAG-BROWN
-- 상태 플래그 'brown'(후상담, 갈색) 추가 — 진료완료(pink)와 수납완료(dark_gray) 사이
-- 2026-06-03 dev-foot
-- additive: 기존 데이터 무영향. constraint 먼저 갱신해야 'brown' 저장 가능 → FE 배포 전/동시 적용.

ALTER TABLE check_ins
  DROP CONSTRAINT IF EXISTS check_ins_status_flag_valid;

ALTER TABLE check_ins
  ADD CONSTRAINT check_ins_status_flag_valid CHECK (
    status_flag IS NULL OR status_flag IN (
      'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'dark_gray'
    )
  );

COMMENT ON COLUMN check_ins.status_flag IS
  '상태 플래그 (카드 배경색): white=정상/red=취소부도/orange=CP데스크/yellow=HL/green=선체험/blue=CP치료실/purple=진료필요/pink=진료완료/brown=후상담/dark_gray=수납완료';
