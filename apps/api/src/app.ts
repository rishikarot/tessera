import cors from '@fastify/cors';
import {
  createAppInput,
  createFieldInput,
  createModuleInput,
  createRecordsInput,
  createViewInput,
  createWorkspaceInput,
  listRecordsQuery,
  updateAppInput,
  updateFieldInput,
  updateModuleInput,
  updateRecordInput,
  updateViewInput,
  ROLES,
} from '@tessera/shared';
import Fastify, { type FastifyRequest } from 'fastify';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { authorize, roleIn } from './access.js';
import { issueToken, userIdFrom } from './auth.js';
import type { Sql } from './db.js';
import { HttpError, badRequest, forbidden, notFound } from './errors.js';
import * as records from './records-service.js';
import * as schema from './schema-service.js';

const parse = <T extends ZodTypeAny>(s: T, data: unknown): z.infer<T> => s.parse(data ?? {});
const idParam = z.object({ id: z.string().uuid() });
const id = (req: FastifyRequest) => parse(idParam, req.params).id;

export function buildApp(sql: Sql, opts: { logger?: boolean; devLogin?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'Invalid request', details: err.flatten() });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true }));

  // ---- auth --------------------------------------------------------------

  if (opts.devLogin ?? process.env.NODE_ENV !== 'production') {
    // Development sign-in: trusts the email given. Replace before going live.
    app.post('/auth/dev-login', async (req) => {
      const body = parse(z.object({ email: z.string().email(), name: z.string().trim().min(1).max(100).optional() }), req.body);
      const email = body.email.toLowerCase();
      const [user] = await sql`
        insert into users (email, name) values (${email}, ${body.name ?? email.split('@')[0]!})
        on conflict (email) do update set name = coalesce(${body.name ?? null}, users.name)
        returning id, email, name`;
      return { token: issueToken(user!.id), user };
    });
  }

  app.get('/me', async (req) => {
    const userId = userIdFrom(req);
    const [user] = await sql`select id, email, name from users where id = ${userId}`;
    if (!user) throw notFound('User');
    return user;
  });

  // ---- workspaces --------------------------------------------------------

  app.get('/workspaces', async (req) => {
    const userId = userIdFrom(req);
    return sql`
      select w.id, w.name, m.role from workspaces w join workspace_members m on m.workspace_id = w.id
      where m.user_id = ${userId} order by w.created_at`;
  });

  app.post('/workspaces', async (req, reply) => {
    const userId = userIdFrom(req);
    const input = parse(createWorkspaceInput, req.body);
    const ws = await sql.begin(async (tx) => {
      const [w] = await tx`insert into workspaces (name) values (${input.name}) returning id, name`;
      await tx`insert into workspace_members (workspace_id, user_id, role) values (${w!.id}, ${userId}, 'owner')`;
      return { ...w, role: 'owner' };
    });
    return reply.status(201).send(ws);
  });

  app.get('/workspaces/:id/members', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'workspace', id(req), 'read');
    return sql`
      select u.id, u.email, u.name, m.role from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = ${id(req)} order by u.name`;
  });

  app.put('/workspaces/:id/members', async (req) => {
    const userId = userIdFrom(req);
    const workspaceId = id(req);
    await authorize(sql, userId, 'workspace', workspaceId, 'workspace.manage');
    const input = parse(z.object({ email: z.string().email(), role: z.enum(ROLES) }), req.body);
    const email = input.email.toLowerCase();
    const [user] = await sql`
      insert into users (email, name) values (${email}, ${email.split('@')[0]!})
      on conflict (email) do update set email = excluded.email returning id`;
    if (user!.id === userId && input.role !== 'owner') throw badRequest('You cannot change your own role');
    await sql`
      insert into workspace_members (workspace_id, user_id, role) values (${workspaceId}, ${user!.id}, ${input.role})
      on conflict (workspace_id, user_id) do update set role = excluded.role`;
    return { userId: user!.id, role: input.role };
  });

  app.get('/workspaces/:id/apps', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'workspace', id(req), 'read');
    return schema.listApps(sql, id(req));
  });

  app.post('/workspaces/:id/apps', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'workspace', id(req), 'schema.edit');
    return reply.status(201).send(await schema.createApp(sql, id(req), parse(createAppInput, req.body)));
  });

  // ---- apps --------------------------------------------------------------

  app.get('/apps/:id', async (req) => {
    const userId = userIdFrom(req);
    const role = await authorize(sql, userId, 'app', id(req), 'read');
    return { ...(await schema.getApp(sql, id(req))), role };
  });

  app.patch('/apps/:id', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'app', id(req), 'schema.edit');
    return schema.updateApp(sql, id(req), parse(updateAppInput, req.body));
  });

  app.delete('/apps/:id', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'app', id(req), 'schema.edit');
    await schema.deleteApp(sql, id(req));
    return reply.status(204).send();
  });

  app.post('/apps/:id/modules', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'app', id(req), 'schema.edit');
    return reply.status(201).send(await schema.createModule(sql, id(req), parse(createModuleInput, req.body), userId));
  });

  // ---- modules -----------------------------------------------------------

  app.get('/modules/:id', async (req) => {
    const userId = userIdFrom(req);
    const role = await authorize(sql, userId, 'module', id(req), 'read');
    return { ...(await schema.getModuleSchema(sql, id(req), userId)), role };
  });

  app.patch('/modules/:id', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'module', id(req), 'schema.edit');
    return schema.updateModule(sql, id(req), parse(updateModuleInput, req.body));
  });

  app.delete('/modules/:id', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'module', id(req), 'schema.edit');
    await schema.deleteModule(sql, id(req));
    return reply.status(204).send();
  });

  app.post('/modules/:id/fields', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'module', id(req), 'schema.edit');
    return reply.status(201).send(await schema.createField(sql, id(req), parse(createFieldInput, req.body)));
  });

  app.post('/modules/:id/views', async (req, reply) => {
    const userId = userIdFrom(req);
    const role = await authorize(sql, userId, 'module', id(req), 'record.comment');
    return reply.status(201).send(await schema.createView(sql, id(req), parse(createViewInput, req.body), userId, role));
  });

  app.get('/modules/:id/records', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'module', id(req), 'read');
    return records.listRecords(sql, id(req), parse(listRecordsQuery, req.query), userId);
  });

  app.post('/modules/:id/records', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'module', id(req), 'record.edit');
    const input = parse(createRecordsInput, req.body);
    return reply.status(201).send({ records: await records.createRecords(sql, id(req), input.records, userId) });
  });

  // ---- fields and views --------------------------------------------------

  app.patch('/fields/:id', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'field', id(req), 'schema.edit');
    return schema.updateField(sql, id(req), parse(updateFieldInput, req.body));
  });

  app.delete('/fields/:id', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'field', id(req), 'schema.edit');
    await schema.deleteField(sql, id(req));
    return reply.status(204).send();
  });

  app.patch('/views/:id', async (req) => {
    const userId = userIdFrom(req);
    const role = await authorize(sql, userId, 'view', id(req), 'record.comment');
    return schema.updateView(sql, id(req), parse(updateViewInput, req.body), userId, role);
  });

  app.delete('/views/:id', async (req, reply) => {
    const userId = userIdFrom(req);
    const role = await authorize(sql, userId, 'view', id(req), 'record.comment');
    await schema.deleteView(sql, id(req), userId, role);
    return reply.status(204).send();
  });

  // ---- records -----------------------------------------------------------

  app.get('/records/:id', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'read');
    return records.getRecord(sql, id(req));
  });

  app.patch('/records/:id', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'record.edit');
    return records.updateRecord(sql, id(req), parse(updateRecordInput, req.body).values, userId);
  });

  app.delete('/records/:id', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'record.edit');
    await records.deleteRecords(sql, [id(req)], userId);
    return reply.status(204).send();
  });

  app.post('/records/:id/restore', async (req, reply) => {
    const userId = userIdFrom(req);
    const [row] = await sql`
      select a.workspace_id from records r join modules m on m.id = r.module_id join apps a on a.id = m.app_id
      where r.id = ${id(req)} and r.deleted_at is not null`;
    const role = row ? await roleIn(sql, row.workspace_id, userId) : null;
    if (!role) throw notFound('Deleted record');
    if (!['owner', 'creator', 'editor'].includes(role)) throw forbidden();
    await records.restoreRecord(sql, id(req), userId);
    return reply.status(204).send();
  });

  app.get('/records/:id/comments', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'read');
    return records.listComments(sql, id(req));
  });

  app.post('/records/:id/comments', async (req, reply) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'record.comment');
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
    return reply.status(201).send(await records.addComment(sql, id(req), body, userId));
  });

  app.get('/records/:id/history', async (req) => {
    const userId = userIdFrom(req);
    await authorize(sql, userId, 'record', id(req), 'read');
    return records.listHistory(sql, id(req));
  });

  // ---- public forms ------------------------------------------------------

  async function publicForm(viewId: string) {
    const [view] = await sql`select * from views where id = ${viewId} and type = 'form'`;
    const v = view ? schema.toView(view) : null;
    if (!v || !v.config.form.isPublic) throw notFound('Form');
    const fields = await schema.loadFields(sql, v.moduleId);
    const shown = v.config.form.fieldIds.map((fid) => fields.find((f) => f.id === fid)).filter((f) => f && f.type !== 'linkedRecord');
    return { view: v, fields: shown as NonNullable<(typeof shown)[number]>[] };
  }

  app.get('/forms/:id', async (req) => {
    const { view, fields } = await publicForm(id(req));
    const { title, description, submitLabel } = view.config.form;
    return { id: view.id, title, description, submitLabel, fields };
  });

  app.post('/forms/:id', async (req, reply) => {
    const { view, fields } = await publicForm(id(req));
    const { values } = parse(updateRecordInput, req.body);
    const allowed = new Set(fields.map((f) => f.id));
    if (Object.keys(values).some((k) => !allowed.has(k))) throw badRequest('This form does not ask for that field');
    await records.createRecords(sql, view.moduleId, [{ values }], null);
    return reply.status(201).send({ message: view.config.form.successMessage });
  });

  return app;
}
