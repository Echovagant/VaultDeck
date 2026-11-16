ALTER TABLE category ADD COLUMN extensions text[] NOT NULL DEFAULT '{}';

UPDATE category SET extensions = ARRAY['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
WHERE category_code = 'IMAGE';

UPDATE category SET extensions = ARRAY['.mp3', '.wav', '.flac', '.aac', '.m4a']
WHERE category_code = 'AUDIO';

UPDATE category SET extensions = ARRAY['.mp4', '.mov', '.avi', '.mkv', '.wmv']
WHERE category_code = 'VIDEO';

UPDATE category SET extensions = ARRAY['.dwg', '.dxf', '.shp', '.kml', '.geojson', '.las']
WHERE category_code = 'SURVEY';

UPDATE category SET extensions = ARRAY['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.csv']
WHERE category_code = 'DOCUMENT';

UPDATE category SET extensions = ARRAY['.zip', '.rar', '.7z']
WHERE category_code = 'OTHER';
