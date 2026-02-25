-- CreateTable plugin_installations
CREATE TABLE "plugin_installations" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "isInstalled" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable project_plugin_links
CREATE TABLE "project_plugin_links" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_plugin_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_installations_pluginId_key"
ON "plugin_installations"("pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "project_plugin_links_projectId_pluginId_key"
ON "project_plugin_links"("projectId", "pluginId");

-- CreateIndex
CREATE INDEX "project_plugin_links_pluginId_idx"
ON "project_plugin_links"("pluginId");

-- AddForeignKey
ALTER TABLE "plugin_installations"
ADD CONSTRAINT "plugin_installations_updatedBy_fkey"
FOREIGN KEY ("updatedBy")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plugin_links"
ADD CONSTRAINT "project_plugin_links_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plugin_links"
ADD CONSTRAINT "project_plugin_links_linkedBy_fkey"
FOREIGN KEY ("linkedBy")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
