import type { Field, Role } from '@tessera/shared';
import { useQueries } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { endpoints, type Member, type ModuleSchema } from './api';

interface ModuleCtx {
  schema: ModuleSchema;
  members: Member[];
  /** Display names of linked records, keyed by record id. */
  linkedNames: Record<string, string>;
  /** Fields of every module this one links to, for rendering lookups. */
  fieldById: (id: string) => Field | undefined;
  role: Role;
}

const Ctx = createContext<ModuleCtx | null>(null);

export function ModuleProvider({ schema, members, linkedNames, children }: { schema: ModuleSchema; members: Member[]; linkedNames: Record<string, string>; children: ReactNode }) {
  const targetIds = useMemo(
    () => [...new Set(schema.fields.filter((f) => f.type === 'linkedRecord').map((f) => f.config.targetModuleId as string))].filter((id) => id !== schema.module.id),
    [schema],
  );
  const targets = useQueries({ queries: targetIds.map((id) => ({ queryKey: ['module', id], queryFn: () => endpoints.module(id) })) });
  const all = new Map<string, Field>();
  for (const f of schema.fields) all.set(f.id, f);
  for (const t of targets) for (const f of t.data?.fields ?? []) all.set(f.id, f);
  const value: ModuleCtx = { schema, members, linkedNames, role: schema.role, fieldById: (id) => all.get(id) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModule(): ModuleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useModule must be inside ModuleProvider');
  return v;
}
