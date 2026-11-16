INSERT INTO role (role_code, role_name)
VALUES
  ('LEADER', '领队'),
  ('DEPUTY_LEADER', '执行领队'),
  ('MEMBER', '队员')
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO category (category_code, category_name, is_system)
VALUES
  ('IMAGE', '图片', true),
  ('AUDIO', '音频', true),
  ('VIDEO', '视频', true),
  ('SURVEY', '测绘', true),
  ('DOCUMENT', '文档', true),
  ('OTHER', '其他', true)
ON CONFLICT (lower(category_code)) DO NOTHING;

INSERT INTO setting (setting_key, setting_value)
VALUES
  ('upload.maxBytes', '21474836480'::jsonb),
  ('upload.chunkSizeBytes', '8388608'::jsonb),
  ('trash.retentionDays', '10'::jsonb),
  ('upload.instantEnabled', 'true'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
