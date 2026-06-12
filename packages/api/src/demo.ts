import { buildServer } from './server.js';
import { seedDemo } from './demo/seed.js';

const ctx = await seedDemo();
const app = buildServer(ctx);
const port = Number(process.env['PORT'] ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(
  `GenFixs demo API on :${port} — project "${ctx.project.name}" (${ctx.project.id}) seeded with every classification`,
);
