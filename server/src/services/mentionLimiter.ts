import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

const LIMITS_FILE = path.join(__dirname, '../../data/mention-limits.json');
const DAILY_LIMIT = 15;
const WARNING_THRESHOLD = 12; // Warn at 80% (12/15)

interface MentionRecord {
  date: string;
  count: number;
}

interface MentionLimits {
  [userId: string]: MentionRecord;
}

// Trusted Circle (unlimited)
const TRUSTED_IDS = [
  'cmlwqo0nj00001yzitzwzcwuy', // Lan
  'cmlwqo0nu00051yzigl0wwn87', // Ice
  'cmlwraeez000c821zh25g9qeb', // Lava
  'gateway-system'               // Gateway
];

async function ensureDataDir() {
  const dir = path.dirname(LIMITS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

async function loadLimits(): Promise<MentionLimits> {
  try {
    const data = await fs.readFile(LIMITS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    // File doesn't exist yet
    return {};
  }
}

async function saveLimits(limits: MentionLimits) {
  await ensureDataDir();
  await fs.writeFile(LIMITS_FILE, JSON.stringify(limits, null, 2));
}

/**
 * Read-only: get current mention budget without incrementing.
 * Safe to call from dashboard / status endpoints.
 */
export async function getMentionBudget(userId: string): Promise<{
  current: number;
  limit: number;
  remaining: number;
}> {
  if (TRUSTED_IDS.includes(userId)) {
    return { current: 0, limit: -1, remaining: -1 };
  }

  const limits = await loadLimits();
  const today = new Date().toISOString().split('T')[0];

  const record = limits[userId];
  const current = (record && record.date === today) ? record.count : 0;

  return {
    current,
    limit: DAILY_LIMIT,
    remaining: DAILY_LIMIT - current,
  };
}

/**
 * Consume one mention credit. Call ONLY when user actually @mentions an agent.
 * Returns whether the mention was allowed and whether a warning should be shown.
 */
export async function consumeMention(userId: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  needsWarning: boolean;
}> {
  // Trusted Circle: unlimited
  if (TRUSTED_IDS.includes(userId)) {
    return { allowed: true, current: 0, limit: -1, needsWarning: false };
  }

  const limits = await loadLimits();
  const today = new Date().toISOString().split('T')[0]; // UTC

  // Reset if new day
  if (!limits[userId] || limits[userId].date !== today) {
    limits[userId] = { date: today, count: 0 };
  }

  const currentCount = limits[userId].count;

  // Check limit BEFORE incrementing
  if (currentCount >= DAILY_LIMIT) {
    logger.info(`Mention limit exceeded for user ${userId}: ${currentCount}/${DAILY_LIMIT}`);
    return {
      allowed: false,
      current: currentCount,
      limit: DAILY_LIMIT,
      needsWarning: false,
    };
  }

  // Increment
  limits[userId].count++;
  await saveLimits(limits);

  const newCount = limits[userId].count;
  const needsWarning = (newCount === WARNING_THRESHOLD);

  if (needsWarning) {
    logger.info(`Mention warning threshold reached for user ${userId}: ${newCount}/${DAILY_LIMIT}`);
  }

  return {
    allowed: true,
    current: newCount,
    limit: DAILY_LIMIT,
    needsWarning,
  };
}

/**
 * @deprecated Use getMentionBudget() for reads, consumeMention() for writes.
 * Kept temporarily for backward compatibility — routes should migrate.
 */
export const checkMentionLimit = consumeMention;
