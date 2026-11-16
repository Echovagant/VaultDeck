DELETE FROM setting
WHERE setting_key IN (
  'upload.maxBytes',
  'upload.chunkSizeBytes',
  'trash.retentionDays',
  'upload.instantEnabled'
);

DELETE FROM category
WHERE is_system = true
  AND category_code IN ('IMAGE', 'AUDIO', 'VIDEO', 'SURVEY', 'DOCUMENT', 'OTHER');

DELETE FROM role
WHERE role_code IN ('LEADER', 'DEPUTY_LEADER', 'MEMBER');
