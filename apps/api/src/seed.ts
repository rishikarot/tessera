import './env.js';
import type { Choice } from '@tessera/shared';
import { connect } from './db.js';
import { migrate } from './migrate.js';
import { createRecords } from './records-service.js';
import { createApp, createField, createModule, createView } from './schema-service.js';

/**
 * Creates a demo Sales CRM (Companies, Contacts, Deals) owned by the email
 * given as the first argument, so a fresh install has something to explore.
 */
const email = (process.argv[2] ?? 'demo@tessera.local').toLowerCase();
const sql = connect();

try {
  await migrate(sql);
  const [user] = await sql`
    insert into users (email, name) values (${email}, ${email.split('@')[0]!})
    on conflict (email) do update set email = excluded.email returning id`;
  const userId = user!.id as string;
  const [ws] = await sql`insert into workspaces (name) values ('Demo workspace') returning id`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws!.id}, ${userId}, 'owner')`;
  const app = await createApp(sql, ws!.id, { name: 'Sales CRM', icon: 'grid', color: 'blue' });

  const companies = await createModule(sql, app.id, { name: 'Companies', primaryFieldName: 'Company' }, userId);
  const industry = await createField(sql, companies.module.id, {
    name: 'Industry',
    type: 'singleSelect',
    required: false,
    config: { choices: [{ name: 'Software', color: 'blue' }, { name: 'Retail', color: 'orange' }, { name: 'Health', color: 'teal' }] },
  });
  const website = await createField(sql, companies.module.id, { name: 'Website', type: 'url', required: false, config: {} });

  const deals = await createModule(sql, app.id, { name: 'Deals', primaryFieldName: 'Deal' }, userId);
  const stage = await createField(sql, deals.module.id, {
    name: 'Stage',
    type: 'singleSelect',
    required: false,
    config: {
      choices: [
        { name: 'Lead', color: 'gray' },
        { name: 'Qualified', color: 'blue' },
        { name: 'Proposal', color: 'orange' },
        { name: 'Won', color: 'green' },
        { name: 'Lost', color: 'red' },
      ],
    },
  });
  const company = await createField(sql, deals.module.id, { name: 'Company', type: 'linkedRecord', required: false, config: { targetModuleId: companies.module.id, allowMultiple: false } });
  const owner = await createField(sql, deals.module.id, { name: 'Owner', type: 'user', required: false, config: {} });
  const value = await createField(sql, deals.module.id, { name: 'Value', type: 'currency', required: false, config: { symbol: '$', precision: 0 } });
  const close = await createField(sql, deals.module.id, { name: 'Close date', type: 'date', required: false, config: {} });
  const priority = await createField(sql, deals.module.id, { name: 'Priority', type: 'rating', required: false, config: { max: 3 } });
  await createField(sql, deals.module.id, { name: 'Notes', type: 'longText', required: false, config: {} });

  const contacts = await createModule(sql, app.id, { name: 'Contacts', primaryFieldName: 'Name' }, userId);
  const contactEmail = await createField(sql, contacts.module.id, { name: 'Email', type: 'email', required: false, config: {} });
  const contactCompany = await createField(sql, contacts.module.id, { name: 'Company', type: 'linkedRecord', required: false, config: { targetModuleId: companies.module.id } });

  const choice = (field: { config: Record<string, unknown> }, name: string) => ((field.config.choices as Choice[]).find((c) => c.name === name)!).id;
  const co = await createRecords(
    sql,
    companies.module.id,
    [
      ['Northwind', 'Retail', 'northwind.example'],
      ['Contoso', 'Software', 'contoso.example'],
      ['Fabrikam', 'Health', 'fabrikam.example'],
    ].map(([n, ind, site]) => ({ values: { [companies.fields[0]!.id]: n, [industry.id]: choice(industry, ind!), [website.id]: site } })),
    userId,
  );
  await createRecords(
    sql,
    deals.module.id,
    (
      [
        ['Website redesign', 'Proposal', 0, 18000, '2026-11-14', 3],
        ['Annual support plan', 'Qualified', 1, 9600, '2026-11-28', 2],
        ['Data migration', 'Won', 2, 24500, '2026-10-20', 3],
        ['Mobile app pilot', 'Lead', 1, 12000, '2026-12-05', 1],
        ['Analytics add-on', 'Qualified', 0, 4800, '2026-11-30', 2],
        ['Onboarding package', 'Lost', 2, 3200, '2026-10-12', 1],
      ] as const
    ).map(([name, st, c, v, d, p]) => ({
      values: { [deals.fields[0]!.id]: name, [stage.id]: choice(stage, st), [company.id]: [co[c]!.id], [owner.id]: userId, [value.id]: v, [close.id]: d, [priority.id]: p },
    })),
    userId,
  );
  await createRecords(
    sql,
    contacts.module.id,
    [
      ['Ana Silva', 'ana@northwind.example', 0],
      ['Ben Okafor', 'ben@contoso.example', 1],
      ['Chen Wei', 'chen@fabrikam.example', 2],
    ].map(([n, e, c]) => ({ values: { [contacts.fields[0]!.id]: n, [contactEmail.id]: e, [contactCompany.id]: [co[c as number]!.id] } })),
    userId,
  );

  // A pipeline total on each company, and a kanban of deals by stage.
  const inverse = company.config.inverseFieldId as string;
  await createField(sql, companies.module.id, { name: 'Pipeline', type: 'rollup', required: false, config: { linkFieldId: inverse, targetFieldId: value.id, aggregate: 'sum' } });
  await createField(sql, companies.module.id, { name: 'Open deals', type: 'count', required: false, config: { linkFieldId: inverse } });
  await createView(sql, deals.module.id, { name: 'Pipeline', type: 'kanban', visibility: 'collaborative', config: { stackFieldId: stage.id } as never }, userId, 'owner');

  console.log(`Seeded "Sales CRM" for ${email}. Sign in with that email.`);
} finally {
  await sql.end();
}
