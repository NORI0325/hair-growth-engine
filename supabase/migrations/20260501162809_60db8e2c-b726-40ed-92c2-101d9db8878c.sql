-- 重複した空っぽの「日吉町店」を2件とも削除
DELETE FROM locations WHERE id IN (
  '6616b4fe-286b-45e8-b61a-831d96f0ba59',
  '1be55bf8-62ba-48ed-b9cf-db2c0b40086d'
);

-- テナントの店舗クォータを1に戻す
UPDATE tenants SET location_quota = 1 WHERE id = 'bacec668-c498-482d-bb40-66599cc9bf9f';