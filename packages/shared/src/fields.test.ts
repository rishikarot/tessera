import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, fieldConfigSchemas, parseFieldConfig, validateValue, can } from './index.js';

const f = (type: (typeof FIELD_TYPES)[number], config: Record<string, unknown> = {}) => ({
  name: 'F',
  type,
  config: parseFieldConfig(type, config).success ? (parseFieldConfig(type, config) as { data: Record<string, unknown> }).data : config,
});

describe('field types', () => {
  it('has a config schema for all 31 types', () => {
    expect(FIELD_TYPES).toHaveLength(31);
    for (const t of FIELD_TYPES) expect(fieldConfigSchemas[t]).toBeDefined();
  });

  it('clears empty values', () => {
    expect(validateValue(f('singleLineText'), '')).toEqual({ ok: true, value: null });
    expect(validateValue(f('checkbox'), null)).toEqual({ ok: true, value: false });
  });

  it('validates text formats', () => {
    expect(validateValue(f('email'), 'a@b.co').ok).toBe(true);
    expect(validateValue(f('email'), 'nope').ok).toBe(false);
    expect(validateValue(f('url'), 'example.com')).toEqual({ ok: true, value: 'https://example.com/' });
    expect(validateValue(f('url'), 'javascript:alert(1)').ok).toBe(false);
    expect(validateValue(f('singleLineText'), 'a\nb')).toEqual({ ok: true, value: 'a b' });
  });

  it('rounds numbers to the field precision', () => {
    expect(validateValue(f('currency'), '12.345')).toEqual({ ok: true, value: 12.35 });
    expect(validateValue(f('number', { precision: 1 }), 2.26)).toEqual({ ok: true, value: 2.3 });
    expect(validateValue(f('number'), 'abc').ok).toBe(false);
  });

  it('checks select options', () => {
    const field = f('singleSelect', { choices: [{ id: 'c1', name: 'Open' }] });
    expect(validateValue(field, 'c1').ok).toBe(true);
    expect(validateValue(field, 'c2').ok).toBe(false);
    const multi = f('multipleSelect', { choices: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(validateValue(multi, ['a', 'a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('validates dates', () => {
    expect(validateValue(f('date'), '2026-10-26').ok).toBe(true);
    expect(validateValue(f('date'), '26/10/2026').ok).toBe(false);
    expect(validateValue(f('date', { includeTime: true }), '2026-10-26T10:00:00Z')).toEqual({ ok: true, value: '2026-10-26T10:00:00.000Z' });
  });

  it('rejects writes to computed fields', () => {
    expect(validateValue(f('createdTime'), 'x').ok).toBe(false);
    expect(validateValue(f('autoNumber'), 1).ok).toBe(false);
  });

  it('enforces single linked record when configured', () => {
    const field = { name: 'L', type: 'linkedRecord' as const, config: { allowMultiple: false } };
    expect(validateValue(field, ['a', 'b']).ok).toBe(false);
    expect(validateValue(field, 'a')).toEqual({ ok: true, value: ['a'] });
  });
});

describe('roles', () => {
  it('follows the role ladder', () => {
    expect(can('owner', 'schema.edit')).toBe(true);
    expect(can('editor', 'schema.edit')).toBe(false);
    expect(can('editor', 'record.edit')).toBe(true);
    expect(can('commenter', 'record.edit')).toBe(false);
    expect(can('readOnly', 'read')).toBe(true);
    expect(can(null, 'read')).toBe(false);
  });
});
