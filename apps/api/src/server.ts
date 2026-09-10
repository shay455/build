import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const { app, close } = await buildApp(env);

await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { await close(); process.exit(0); });
}
