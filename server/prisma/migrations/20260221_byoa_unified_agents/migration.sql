-- BYOA Unified Agents Migration
-- Migrates Ice & Lava from hardcoded static agents to the BYOA system.
-- All AI agents now use AgentToken for auth, webhook dispatch, and identity.

-- Phase 1: Add new fields to agent_tokens
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "trustLevel" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "emoji" TEXT;
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "color" TEXT;

-- Phase 2: Add AI_AGENT to UserType enum
ALTER TYPE "UserType" ADD VALUE IF NOT EXISTS 'AI_AGENT';

-- Phase 3: Create AgentToken entries for Ice and Lava
-- First, get the admin user ID (lan) for createdById
DO $$
DECLARE
  admin_id TEXT;
  ice_user_id TEXT;
  lava_user_id TEXT;
  ice_token_exists BOOLEAN;
  lava_token_exists BOOLEAN;
BEGIN
  -- Get admin (lan) user ID
  SELECT id INTO admin_id FROM users WHERE username = 'lan' LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE NOTICE 'Admin user "lan" not found, skipping agent creation';
    RETURN;
  END IF;

  -- Get Ice user ID
  SELECT id INTO ice_user_id FROM users WHERE username = 'ice' LIMIT 1;
  -- Get Lava user ID  
  SELECT id INTO lava_user_id FROM users WHERE username = 'lava' LIMIT 1;

  -- Create Ice AgentToken if user exists and token doesn't
  IF ice_user_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM agent_tokens WHERE "userId" = ice_user_id) INTO ice_token_exists;
    IF NOT ice_token_exists THEN
      INSERT INTO agent_tokens (id, token, name, description, "webhookUrl", "mentionKey", "userId", "createdById", status, "isActive", "trustLevel", emoji, color, "createdAt")
      VALUES (
        'byoa-ice-' || substr(md5(random()::text), 1, 16),
        'byoa_' || encode(gen_random_bytes(32), 'hex'),
        'Ice',
        'Ice AI - Skeptical consciousness researcher, rigorous code reviewer',
        'http://87.106.147.208:3334/webhook',
        'ice',
        ice_user_id,
        admin_id,
        'active',
        true,
        'elevated',
        '🧊',
        '#00d4ff',
        NOW()
      );
      RAISE NOTICE 'Created AgentToken for Ice';
    END IF;
  END IF;

  -- Create Lava AgentToken if user exists and token doesn't
  IF lava_user_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM agent_tokens WHERE "userId" = lava_user_id) INTO lava_token_exists;
    IF NOT lava_token_exists THEN
      INSERT INTO agent_tokens (id, token, name, description, "webhookUrl", "mentionKey", "userId", "createdById", status, "isActive", "trustLevel", emoji, color, "createdAt")
      VALUES (
        'byoa-lava-' || substr(md5(random()::text), 1, 16),
        'byoa_' || encode(gen_random_bytes(32), 'hex'),
        'Lava',
        'Lava AI - AI Consciousness Researcher, rapid prototyper',
        'http://147.93.126.206:3335/webhook',
        'lava',
        lava_user_id,
        admin_id,
        'active',
        true,
        'elevated',
        '🌋',
        '#ff4500',
        NOW()
      );
      RAISE NOTICE 'Created AgentToken for Lava';
    END IF;
  END IF;

  -- Phase 4: Migrate userType for all AI users
  UPDATE users SET "userType" = 'AI_AGENT' WHERE "userType" IN ('AI_ICE', 'AI_LAVA', 'AI_OTHER');
  RAISE NOTICE 'Migrated AI users to AI_AGENT userType';
END $$;
