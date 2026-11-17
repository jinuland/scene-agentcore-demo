import { createRuntimeServer } from "./handler";
const server = createRuntimeServer();
server.requestTimeout = 130000;
const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid runtime port");
server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  if (address && typeof address !== "string")
    console.log(JSON.stringify({ runtimeReady: true, port: address.port }));
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
