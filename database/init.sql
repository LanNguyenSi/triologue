-- Triologue Database Initialization
-- This file is automatically executed when PostgreSQL container starts

-- Create database if not exists (already handled by POSTGRES_DB env var)
-- Additional initialization can be added here if needed

-- Set timezone
SET timezone = 'UTC';

-- Log successful initialization
INSERT INTO pg_settings (name, setting) VALUES ('log_statement', 'all') ON CONFLICT DO NOTHING;