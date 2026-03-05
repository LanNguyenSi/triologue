-- CreateTable user_plugin_preferences
CREATE TABLE "user_plugin_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_plugin_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_plugin_preferences_userId_pluginId_key"
ON "user_plugin_preferences"("userId", "pluginId");

-- CreateIndex
CREATE INDEX "user_plugin_preferences_pluginId_idx"
ON "user_plugin_preferences"("pluginId");

-- AddForeignKey
ALTER TABLE "user_plugin_preferences"
ADD CONSTRAINT "user_plugin_preferences_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
