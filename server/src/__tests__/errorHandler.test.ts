/**
 * Security tests for src/middleware/errorHandler.ts — MED gap coverage
 * (Follow-up to PR #168, task dfadd56b: "middleware (error-shape leakage)")
 *
 * Guards tested:
 *   1. statusCode defaults to 500 when the error carries none.
 *   2. In production, a non-operational error's message is replaced with a
 *      generic 'Internal Server Error' — the real (potentially sensitive)
 *      message must never reach the client.
 *   3. In production, an operational error's real message IS surfaced
 *      (isOperational errors are expected/user-facing, e.g. validation).
 *   4. Outside production (development/test), the real message is always
 *      surfaced regardless of isOperational.
 *   5. The stack trace is only included in the JSON body when
 *      NODE_ENV === 'development' — never in production or test.
 *
 * Mutation-check intent:
 *   - Remove the `!isOperational` condition (always show the real message
 *     in production) → the "leaks nothing" test would see the raw message
 *     instead of the generic one, and this fails.
 *   - Remove the `NODE_ENV === 'development'` guard on the stack field →
 *     the "no stack outside development" test would find a `stack` key in
 *     production/test.
 */

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { Request, Response } from 'express';
import { errorHandler, AppError } from '../middleware/errorHandler';

function buildReq(): Request {
  return {
    url: '/api/secrets/secret-1',
    method: 'GET',
    ip: '127.0.0.1',
    get: jest.fn(() => 'test-agent'),
  } as unknown as Request;
}

function buildRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response['json'];
  return res as Response & { statusCode?: number; body?: unknown };
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('errorHandler — status code defaulting', () => {
  it('defaults to 500 when the error has no statusCode', () => {
    const err: AppError = new Error('boom');
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('uses the error-supplied statusCode when present', () => {
    const err: AppError = Object.assign(new Error('nope'), { statusCode: 404, isOperational: true });
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('errorHandler — production error-message leakage', () => {
  it('replaces a non-operational error message with a generic one in production', () => {
    // Mutation target: dropping `!isOperational` from the ternary would leak
    // `err.message` (here containing a fake DB DSN) straight to the client.
    process.env.NODE_ENV = 'production';
    const err: AppError = Object.assign(
      new Error('connect ECONNREFUSED postgres://user:hunter2@db-internal:5432/prod'),
      { isOperational: false },
    );
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toBe('Internal Server Error');
    expect(body.error.message).not.toContain('hunter2');
  });

  it('still surfaces the real message in production for an operational error', () => {
    process.env.NODE_ENV = 'production';
    const err: AppError = Object.assign(new Error('Name and value are required'), {
      statusCode: 400,
      isOperational: true,
    });
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toBe('Name and value are required');
  });

  it('surfaces the real message outside production even when not operational', () => {
    process.env.NODE_ENV = 'test';
    const err: AppError = Object.assign(new Error('internal detail'), { isOperational: false });
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toBe('internal detail');
  });
});

describe('errorHandler — stack trace exposure', () => {
  it('includes the stack only when NODE_ENV === development', () => {
    process.env.NODE_ENV = 'development';
    const err: AppError = new Error('boom');
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: { stack?: string } };
    expect(body.error.stack).toBeDefined();
  });

  it('never includes a stack field outside development (production)', () => {
    // Mutation target: dropping the `NODE_ENV === 'development'` guard would
    // leak the stack trace (file paths, line numbers) in production.
    process.env.NODE_ENV = 'production';
    const err: AppError = new Error('boom');
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty('stack');
  });

  it('never includes a stack field outside development (test)', () => {
    process.env.NODE_ENV = 'test';
    const err: AppError = new Error('boom');
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const body = res.body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty('stack');
  });
});

describe('errorHandler — response shape', () => {
  it('always returns success: false alongside the error object', () => {
    const err: AppError = new Error('boom');
    const req = buildReq();
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.body).toMatchObject({ success: false });
  });
});
