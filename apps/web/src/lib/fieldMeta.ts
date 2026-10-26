import type { FieldType } from '@tessera/shared';

/** How each field type is named, grouped and described in the field picker. */
export const FIELD_GROUPS: { label: string; types: FieldType[] }[] = [
  { label: 'Text', types: ['singleLineText', 'longText', 'email', 'url', 'phone'] },
  { label: 'Numbers', types: ['number', 'currency', 'percent', 'duration', 'rating', 'autoNumber'] },
  { label: 'Choice', types: ['singleSelect', 'multipleSelect', 'checkbox'] },
  { label: 'Date and time', types: ['date', 'createdTime', 'lastModifiedTime'] },
  { label: 'People', types: ['user', 'createdBy', 'lastModifiedBy'] },
  { label: 'Relations', types: ['linkedRecord', 'lookup', 'rollup', 'count', 'formula'] },
  { label: 'Files and actions', types: ['attachment', 'barcode', 'button', 'ai', 'signature', 'location'] },
];

export const FIELD_LABELS: Record<FieldType, string> = {
  singleLineText: 'Single line text',
  longText: 'Long text',
  email: 'Email',
  url: 'URL',
  phone: 'Phone number',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  duration: 'Duration',
  rating: 'Rating',
  autoNumber: 'Autonumber',
  singleSelect: 'Single select',
  multipleSelect: 'Multiple select',
  checkbox: 'Checkbox',
  date: 'Date',
  createdTime: 'Created time',
  lastModifiedTime: 'Last modified time',
  user: 'User',
  createdBy: 'Created by',
  lastModifiedBy: 'Last modified by',
  linkedRecord: 'Link to another module',
  lookup: 'Lookup',
  rollup: 'Rollup',
  count: 'Count',
  formula: 'Formula',
  attachment: 'Attachment',
  barcode: 'Barcode',
  button: 'Button',
  ai: 'AI',
  signature: 'Signature',
  location: 'Location',
};

/** Short glyphs shown in column headers; plain text keeps the look quiet. */
export const FIELD_GLYPHS: Record<FieldType, string> = {
  singleLineText: 'Aa',
  longText: '¶',
  email: '@',
  url: '↗',
  phone: '☏',
  number: '#',
  currency: '$',
  percent: '%',
  duration: '◷',
  rating: '★',
  autoNumber: '№',
  singleSelect: '◉',
  multipleSelect: '☰',
  checkbox: '☑',
  date: '▦',
  createdTime: '▦',
  lastModifiedTime: '▦',
  user: '◎',
  createdBy: '◎',
  lastModifiedBy: '◎',
  linkedRecord: '⇄',
  lookup: '⤷',
  rollup: 'Σ',
  count: '∑',
  formula: 'ƒ',
  attachment: '⎘',
  barcode: '▥',
  button: '▢',
  ai: '✦',
  signature: '✎',
  location: '⌖',
};

/** Types that are planned but not yet functional, with the phase they land in. */
export const COMING_LATER: Partial<Record<FieldType, string>> = {
  formula: 'Formulas are calculated from Phase 2',
  ai: 'AI fields are filled in from Phase 4',
  button: 'Buttons run actions once automations arrive in Phase 2',
};

export const NUMERIC_TYPES = new Set<FieldType>(['number', 'currency', 'percent', 'duration', 'rating', 'autoNumber', 'count']);
