import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { connect, type Sql } from '../src/db.js';
import { migrate } from '../src/migrate.js';

/**
 * End-to-end API tests against a real Postgres. Uses TEST_DATABASE_URL, or a
 * tessera_test database next to DATABASE_URL, and resets it on each run.
 */
const base = process.env.DATABASE_URL ?? 'postgres://tessera:tessera@localhost:5432/tessera';
const url = process.env.TEST_DATABASE_URL ?? base.replace(/\/[^/]+$/, '/tessera_test');

let sql: Sql;
let app: ReturnType<typeof buildApp>;

async function resetDatabase() {
  const admin = connect(url.replace(/\/[^/]+$/, '/postgres'));
  const name = new URL(url).pathname.slice(1);
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();
}

type Json = any;
async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await app.inject({
    method: method as 'GET',
    url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

async function login(email: string) {
  const { json } = await call('POST', '/auth/dev-login', undefined, { email });
  return json.token as string;
}

beforeAll(async () => {
  await resetDatabase();
  sql = connect(url);
  await migrate(sql);
  app = buildApp(sql, { devLogin: true });
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('Tessera API', () => {
  let owner: string;
  let workspaceId: string;
  let appId: string;
  let deals: Json;
  let companies: Json;

  it('signs in and creates a workspace and app', async () => {
    owner = await login('rishi@example.com');
    expect((await call('GET', '/me')).status).toBe(401);
    const ws = await call('POST', '/workspaces', owner, { name: 'Acme' });
    expect(ws.status).toBe(201);
    workspaceId = ws.json.id;
    const created = await call('POST', `/workspaces/${workspaceId}/apps`, owner, { name: 'Sales CRM' });
    expect(created.status).toBe(201);
    appId = created.json.id;
  });

  it('creates modules with a primary field and a default grid view', async () => {
    const d = await call('POST', `/apps/${appId}/modules`, owner, { name: 'Deals', primaryFieldName: 'Deal' });
    expect(d.status).toBe(201);
    deals = d.json;
    expect(deals.fields).toHaveLength(1);
    expect(deals.fields[0]).toMatchObject({ name: 'Deal', type: 'singleLineText', isPrimary: true });
    expect(deals.views[0]).toMatchObject({ type: 'grid', name: 'Grid view' });
    companies = (await call('POST', `/apps/${appId}/modules`, owner, { name: 'Companies' })).json;
  });

  let stage: Json, value: Json, company: Json, inverse: Json, closeDate: Json;

  it('adds typed fields and rejects bad config', async () => {
    stage = (await call('POST', `/modules/${deals.module.id}/fields`, owner, {
      name: 'Stage',
      type: 'singleSelect',
      config: { choices: [{ name: 'Lead' }, { name: 'Won', color: 'green' }] },
    })).json;
    expect(stage.config.choices).toHaveLength(2);
    expect(stage.config.choices[0].id).toMatch(/^opt/);

    value = (await call('POST', `/modules/${deals.module.id}/fields`, owner, { name: 'Value', type: 'currency' })).json;
    closeDate = (await call('POST', `/modules/${deals.module.id}/fields`, owner, { name: 'Close date', type: 'date' })).json;

    const dup = await call('POST', `/modules/${deals.module.id}/fields`, owner, { name: 'value', type: 'number' });
    expect(dup.status).toBe(400);
    const badLookup = await call('POST', `/modules/${deals.module.id}/fields`, owner, {
      name: 'Bad',
      type: 'lookup',
      config: { linkFieldId: stage.id, targetFieldId: stage.id },
    });
    expect(badLookup.status).toBe(400);
  });

  it('creates a paired field when linking two modules', async () => {
    company = (await call('POST', `/modules/${deals.module.id}/fields`, owner, {
      name: 'Company',
      type: 'linkedRecord',
      config: { targetModuleId: companies.module.id, allowMultiple: false },
    })).json;
    expect(company.config.inverseFieldId).toBeTruthy();
    const companySchema = (await call('GET', `/modules/${companies.module.id}`, owner)).json;
    inverse = companySchema.fields.find((f: Json) => f.id === company.config.inverseFieldId);
    expect(inverse).toMatchObject({ name: 'Deals', type: 'linkedRecord' });
  });

  let acme: Json, deal1: Json, deal2: Json;

  it('creates records, validates values and keeps links in sync both ways', async () => {
    acme = (await call('POST', `/modules/${companies.module.id}/records`, owner, { records: [{ values: { [companies.fields[0].id]: 'Acme Ltd' } }] })).json.records[0];

    const bad = await call('POST', `/modules/${deals.module.id}/records`, owner, { records: [{ values: { [value.id]: 'lots' } }] });
    expect(bad.status).toBe(400);
    expect(bad.json.details.fields[value.id]).toBe('Expected a number');

    const res = await call('POST', `/modules/${deals.module.id}/records`, owner, {
      records: [
        { values: { [deals.fields[0].id]: 'Website', [stage.id]: stage.config.choices[1].id, [value.id]: 1000.456, [company.id]: [acme.id], [closeDate.id]: '2026-11-14' } },
        { values: { [deals.fields[0].id]: 'Support plan', [stage.id]: stage.config.choices[0].id, [value.id]: 250, [company.id]: [acme.id] } },
      ],
    });
    expect(res.status).toBe(201);
    [deal1, deal2] = res.json.records;
    expect(deal1.values[value.id]).toBe(1000.46);
    expect(deal1.autoNumber).toBe(1);
    expect(deal2.autoNumber).toBe(2);

    const back = (await call('GET', `/records/${acme.id}`, owner)).json;
    expect(back.values[inverse.id]).toEqual([deal1.id, deal2.id]);
    expect(back.linkedNames[deal1.id]).toBe('Website');

    await call('PATCH', `/records/${deal2.id}`, owner, { values: { [company.id]: [] } });
    const after = (await call('GET', `/records/${acme.id}`, owner)).json;
    expect(after.values[inverse.id]).toEqual([deal1.id]);
  });

  it('computes lookups, rollups and counts', async () => {
    await call('PATCH', `/records/${deal2.id}`, owner, { values: { [company.id]: [acme.id] } });
    const mk = async (body: object) => (await call('POST', `/modules/${companies.module.id}/fields`, owner, body)).json;
    const total = await mk({ name: 'Pipeline', type: 'rollup', config: { linkFieldId: inverse.id, targetFieldId: value.id, aggregate: 'sum' } });
    const count = await mk({ name: 'Deal count', type: 'count', config: { linkFieldId: inverse.id } });
    const names = await mk({ name: 'Deal names', type: 'lookup', config: { linkFieldId: inverse.id, targetFieldId: deals.fields[0].id } });
    const rec = (await call('GET', `/records/${acme.id}`, owner)).json;
    expect(rec.values[total.id]).toBeCloseTo(1250.46);
    expect(rec.values[count.id]).toBe(2);
    expect(rec.values[names.id]).toEqual(['Website', 'Support plan']);
  });

  it('filters, sorts and searches through a view', async () => {
    const view = (await call('POST', `/modules/${deals.module.id}/views`, owner, {
      name: 'Big deals',
      type: 'grid',
      config: { filter: { conditions: [{ fieldId: value.id, operator: 'gt', value: 500 }] }, sorts: [{ fieldId: value.id, direction: 'desc' }] },
    })).json;
    const listed = (await call('GET', `/modules/${deals.module.id}/records?viewId=${view.id}`, owner)).json;
    expect(listed.records.map((r: Json) => r.id)).toEqual([deal1.id]);

    const sorted = (await call('GET', `/modules/${deals.module.id}/records`, owner)).json;
    expect(sorted.total).toBe(2);
    const search = (await call('GET', `/modules/${deals.module.id}/records?search=support`, owner)).json;
    expect(search.records.map((r: Json) => r.id)).toEqual([deal2.id]);
    const byStage = (await call('GET', `/modules/${deals.module.id}/records?search=won`, owner)).json;
    expect(byStage.records.map((r: Json) => r.id)).toEqual([deal1.id]);
  });

  it('converts values when a field changes type', async () => {
    const res = await call('PATCH', `/fields/${stage.id}`, owner, { type: 'singleLineText' });
    expect(res.status).toBe(200);
    const rec = (await call('GET', `/records/${deal1.id}`, owner)).json;
    expect(rec.values[stage.id]).toBe('Won');
    const back = (await call('PATCH', `/fields/${stage.id}`, owner, { type: 'singleSelect' })).json;
    const won = back.config.choices.find((c: Json) => c.name === 'Won');
    expect((await call('GET', `/records/${deal1.id}`, owner)).json.values[stage.id]).toBe(won.id);
  });

  it('records history and comments', async () => {
    await call('POST', `/records/${deal1.id}/comments`, owner, { body: 'Call them Monday' });
    const comments = (await call('GET', `/records/${deal1.id}/comments`, owner)).json;
    expect(comments[0].body).toBe('Call them Monday');
    const history = (await call('GET', `/records/${deal2.id}/history`, owner)).json;
    expect(history.map((h: Json) => h.action)).toEqual(['update', 'update', 'create']);
  });

  it('enforces roles', async () => {
    const editor = await login('editor@example.com');
    const stranger = await login('stranger@example.com');
    await call('PUT', `/workspaces/${workspaceId}/members`, owner, { email: 'editor@example.com', role: 'editor' });

    expect((await call('GET', `/modules/${deals.module.id}`, stranger)).status).toBe(404);
    expect((await call('POST', `/modules/${deals.module.id}/fields`, editor, { name: 'X', type: 'number' })).status).toBe(403);
    expect((await call('PATCH', `/records/${deal1.id}`, editor, { values: { [value.id]: 5 } })).status).toBe(200);

    const locked = (await call('POST', `/modules/${deals.module.id}/views`, owner, { name: 'Locked', type: 'kanban', visibility: 'locked' })).json;
    expect((await call('PATCH', `/views/${locked.id}`, editor, { name: 'Mine now' })).status).toBe(403);
    const personal = (await call('POST', `/modules/${deals.module.id}/views`, editor, { name: 'My view', type: 'grid', visibility: 'personal' })).json;
    const ownerViews = (await call('GET', `/modules/${deals.module.id}`, owner)).json.views;
    expect(ownerViews.some((v: Json) => v.id === personal.id)).toBe(false);
  });

  it('accepts public form submissions only for listed fields', async () => {
    const form = (await call('POST', `/modules/${deals.module.id}/views`, owner, {
      name: 'Intake',
      type: 'form',
      config: { form: { title: 'New deal', fieldIds: [deals.fields[0].id, value.id], isPublic: true } },
    })).json;
    const shown = (await call('GET', `/forms/${form.id}`)).json;
    expect(shown.fields.map((f: Json) => f.name)).toEqual(['Deal', 'Value']);
    expect((await call('POST', `/forms/${form.id}`, undefined, { values: { [deals.fields[0].id]: 'From form', [value.id]: 42 } })).status).toBe(201);
    expect((await call('POST', `/forms/${form.id}`, undefined, { values: { [closeDate.id]: '2026-01-01' } })).status).toBe(400);
  });

  it('soft deletes and restores records', async () => {
    expect((await call('DELETE', `/records/${deal2.id}`, owner)).status).toBe(204);
    expect((await call('GET', `/records/${deal2.id}`, owner)).status).toBe(404);
    expect((await call('POST', `/records/${deal2.id}/restore`, owner)).status).toBe(204);
    expect((await call('GET', `/records/${deal2.id}`, owner)).status).toBe(200);
  });
});
