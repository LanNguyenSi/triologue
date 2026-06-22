/**
 * Side-effect contract for the app module.
 *
 * Importing `../index` (as server route tests do via `import { app }`) must:
 *   1. expose the Express app, and
 *   2. NOT boot the HTTP server — the `require.main === module` gate in
 *      index.ts means startServer() runs only when the file is the entrypoint,
 *      so an import must not bind a port or trip startServer's process.exit.
 *
 * The second test is a mutation killer for that gate: delete the
 * `if (require.main === module)` guard in index.ts and it fails. It asserts
 * BOTH that process.exit and server.listen are never called, so it catches the
 * regression independent of the test environment: with the gate removed,
 * startServer() reaches process.exit() on a box without Redis/DB, and reaches
 * server.listen() on a box that has them (e.g. once task ee8ee6bc adds a
 * Postgres service to the CI job). It relies on importing the module being free
 * of lingering open handles (lazy Redis connect in routes/rooms.ts, unref'd
 * timer in services/integrationOAuth.ts); without that, this suite would also
 * trip jest's "worker failed to exit gracefully" warning.
 */
import * as net from "net";
import { app } from "../index";

describe("index module import side-effects", () => {
  it("exports a usable Express app", () => {
    expect(app).toBeDefined();
    expect(typeof app).toBe("function");
  });

  it("does not boot the server (no listen, no process.exit) when imported", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const listenSpy = jest
      .spyOn(net.Server.prototype, "listen")
      .mockImplementation(function (this: net.Server) {
        return this;
      } as never);

    jest.resetModules();
    jest.isolateModules(() => {
      // require.main is the jest runner, not this module, so the gate is false
      // and startServer() must NOT run.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred load so process.exit/listen spies are installed before the module executes
      require("../index");
    });

    // startServer()'s failure path (Redis/DB unavailable) calls process.exit
    // asynchronously; give it a tick to prove neither boot path is reached.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(listenSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    listenSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
