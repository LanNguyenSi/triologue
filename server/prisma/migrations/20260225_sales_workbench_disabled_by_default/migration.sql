-- Set initial workspace policy: sales-workbench starts disabled until explicitly enabled.
-- Keep existing manual policy untouched if already present.
INSERT INTO "plugin_installations" (
  "id",
  "pluginId",
  "isInstalled",
  "isEnabled",
  "updatedBy",
  "createdAt",
  "updatedAt"
)
VALUES (
  'sales-workbench-default-disabled',
  'sales-workbench',
  true,
  false,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT ("pluginId") DO NOTHING;
