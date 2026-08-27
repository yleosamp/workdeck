import { buildServer } from "./app.js";
import { config } from "./config.js";

const app = await buildServer();
try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`Workdeck API disponível em ${address}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
