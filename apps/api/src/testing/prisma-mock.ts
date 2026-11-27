/** A Prisma stand-in: every `model.method` is a jest.fn created on first use; transactions run on itself. */
export function prismaMock(): any {
  const models: Record<string, any> = {};
  const root: any = new Proxy({}, {
    get(_t, model: string) {
      if (model === 'then') return undefined;
      if (model === '$transaction') return (arg: any) => (typeof arg === 'function' ? arg(root) : Promise.all(arg));
      if (model === '$queryRaw') return (models.$queryRaw ??= jest.fn());
      return (models[model] ??= new Proxy({} as Record<string, jest.Mock>, {
        get(target, method: string) { return (target[method] ??= jest.fn()); },
      }));
    },
  });
  return root;
}
