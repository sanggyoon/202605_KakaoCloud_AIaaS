-- P1 마이그레이션. vm5(ai)와 vm4(data) 각각 해당 SQL Editor에서 실행.

-- ── vm5 (ai.peakly.art) ──────────────────────────────
-- 1) 활성 모델 버전 플래그
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;
UPDATE model_versions SET active = true  WHERE model_version = 'roberta-va-v1';
UPDATE model_versions SET active = false WHERE model_version <> 'roberta-va-v1';

-- 2) 고아 scene_scores 정리(재파싱 잔재: 현재 scenes에 없는 scenes_id)
DELETE FROM scene_scores ss WHERE NOT EXISTS (SELECT 1 FROM scenes s WHERE s.id = ss.scenes_id);

-- ── vm4 (data.peakly.art) ────────────────────────────
-- 3) FE용 활성버전 미러 (anon SELECT 허용 필요)
CREATE TABLE IF NOT EXISTS app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO app_config (key, value) VALUES ('active_model_version', 'roberta-va-v1')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- RLS가 켜져 있으면 anon read 정책 추가:
-- ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY app_config_read ON app_config FOR SELECT TO anon USING (true);
