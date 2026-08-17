import type { Gateway } from "./gateway.js";
import { createGatewayServer } from "./server.js";

/**
 * Serves a gateway over stdio, the transport coding-agent hosts launch.
 *
 * Nothing may be written to stdout except protocol frames: a stray `console.log`
 * corrupts the stream. Diagnostics belong on stderr.
 */
export async function serveStdio(gateway: Gateway): Promise<() => Promise<void>> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = await createGatewayServer({ gateway });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return async () => {
    await server.close();
    await gateway.close();
  };
}
