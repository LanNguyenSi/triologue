CREATE TABLE "mcp_connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'sse',
    "url" TEXT NOT NULL,
    "apiKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "discoveredTools" JSONB NOT NULL DEFAULT '[]',
    "lastHealthCheck" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
