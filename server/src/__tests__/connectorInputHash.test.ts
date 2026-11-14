/**
 * Canonical hash of a connector action input (connectors/inputHash.ts), the
 * value an approval is bound to. Each rule of the canonical form is its own
 * case: what must hash alike (key order, undefined keys, number spelling) and
 * what must not (values, extra keys, nesting, array order, types, null vs
 * absent).
 */
import { canonicalJson, hashActionInput } from '../connectors/inputHash';

describe('hashActionInput: inputs that must hash alike', () => {
  it('ignores key order at the top level', () => {
    expect(hashActionInput({ a: 1, b: 2 })).toBe(hashActionInput({ b: 2, a: 1 }));
  });

  it('ignores key order at every nesting level, including objects inside arrays', () => {
    const one = { x: { b: 1, a: [{ d: 4, c: 3 }] }, y: 0 };
    const two = { y: 0, x: { a: [{ c: 3, d: 4 }], b: 1 } };
    expect(hashActionInput(one)).toBe(hashActionInput(two));
  });

  it('drops keys whose value is undefined', () => {
    expect(hashActionInput({ a: 1, b: undefined })).toBe(hashActionInput({ a: 1 }));
  });

  it('spells numbers the way JSON does: 1 and 1.0 are one number', () => {
    expect(hashActionInput(JSON.parse('{"n":1.0}'))).toBe(hashActionInput({ n: 1 }));
    expect(hashActionInput(JSON.parse('{"n":1e2}'))).toBe(hashActionInput({ n: 100 }));
  });

  it('treats an empty object and an object of undefined keys alike', () => {
    expect(hashActionInput({})).toBe(hashActionInput({ a: undefined }));
  });

  it('is stable: the same input hashes to the same 64 hex characters', () => {
    const hash = hashActionInput({ driveId: 'd', itemId: 'i' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashActionInput({ driveId: 'd', itemId: 'i' })).toBe(hash);
  });
});

describe('hashActionInput: inputs that must hash differently', () => {
  const base = { driveId: 'd1', itemId: 'i1' };

  it('differs when a value changes', () => {
    expect(hashActionInput({ ...base, itemId: 'i2' })).not.toBe(hashActionInput(base));
  });

  it('differs when a key is added', () => {
    expect(hashActionInput({ ...base, recursive: true })).not.toBe(hashActionInput(base));
  });

  it('differs when a key is removed', () => {
    expect(hashActionInput({ driveId: 'd1' })).not.toBe(hashActionInput(base));
  });

  it('differs when the same content is nested one level deeper', () => {
    expect(hashActionInput({ target: base })).not.toBe(hashActionInput(base));
  });

  it('differs when array order changes', () => {
    expect(hashActionInput({ ids: [1, 2] })).not.toBe(hashActionInput({ ids: [2, 1] }));
  });

  it('differs between a string and a number', () => {
    expect(hashActionInput({ n: '1' })).not.toBe(hashActionInput({ n: 1 }));
  });

  it('differs between an explicit null and an absent key', () => {
    expect(hashActionInput({ a: null })).not.toBe(hashActionInput({}));
  });

  it('cannot be forged by moving text between a key and a value', () => {
    expect(hashActionInput({ 'a": "b': 'c' })).not.toBe(hashActionInput({ a: 'b", "c' }));
  });

  it('escapes keys, so a key carrying JSON punctuation cannot collide with two keys', () => {
    // Unescaped keys would turn both into {"a":1,"b":2}.
    expect(hashActionInput({ 'a":1,"b': 2 })).not.toBe(hashActionInput({ a: 1, b: 2 }));
  });

  it('keeps a key literally named __proto__ distinct from an empty input', () => {
    const withProto = JSON.parse('{"__proto__":{"admin":true}}');
    expect(hashActionInput(withProto)).not.toBe(hashActionInput({}));
  });
});

describe('canonicalJson: unsupported values are refused, not coerced', () => {
  it('throws on a bigint', () => {
    expect(() => canonicalJson({ n: BigInt(1) })).toThrow(TypeError);
  });

  it('throws on a non-finite number', () => {
    expect(() => canonicalJson({ n: Infinity })).toThrow(TypeError);
  });

  it('throws on a circular structure', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(TypeError);
  });

  it('accepts the same object referenced twice (a shared reference is not a cycle)', () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });

  it('renders the canonical text without whitespace and with sorted keys', () => {
    expect(canonicalJson({ b: [1, undefined, 'x'], a: null })).toBe('{"a":null,"b":[1,null,"x"]}');
  });
});
