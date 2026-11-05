import { test, expect } from "@playwright/test";
import { createServer, request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join, sep, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { phoneSite } from "../tools/phone";

test("phone review API exposes only selected-round reads and preserves study data", async () => {
  const root = resolve("D:/dev-data/kyoku-loop/private"),
    folder = mkdtempSync(join(root, "round-api-"));
  const db = join(folder, "test.sqlite3"),
    old = process.env.KYOKULOOP_DB;
  const call = (input: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(input),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, KYOKULOOP_DB: db },
      }),
    );
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const raw = execFileSync(
      "python",
      [
        "-c",
        "import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture;print(json.dumps(mortal_fixture()))",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const stage = call({
      action: "inspect",
      data: Buffer.from(raw).toString("base64"),
    }).data;
    const report = call({
      action: "commit",
      token: stage.token,
      seat: 0,
      model: 0,
      source_url: "",
    }).data.id;
    const before = call({ action: "state" });
    process.env.KYOKULOOP_DB = db;
    let handler: any;
    (phoneSite().configureServer as Function)({
      middlewares: {
        use: (h: any) => {
          handler = h;
        },
      },
    });
    server = createServer((req, res) =>
      handler(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("fixture server missing");
    const send = (body: object) =>
      new Promise<{ status: number; data: any }>((done, fail) => {
        const r = request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/phone/api",
            method: "POST",
            headers: {
              host: "127.0.0.1:1460",
              "content-type": "application/json",
            },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () =>
              done({ status: res.statusCode!, data: JSON.parse(text) }),
            );
          },
        );
        r.on("error", fail);
        r.end(JSON.stringify(body));
      });
    const catalog = await send({ action: "round_review_catalog", report });
    expect(catalog.status).toBe(200);
    expect(catalog.data.ok).toBe(true);
    expect(catalog.data.data.rounds).toHaveLength(1);
    const material = await send({
      action: "round_review_material",
      report,
      round_index: 0,
    });
    expect(material.status).toBe(200);
    expect(material.data.ok).toBe(true);
    expect(material.data.data.timeline).toHaveLength(3);
    for (const body of [
      { action: "round_review_material", report, round_index: -1 },
      { action: "round_review_material", report, round_index: "0" },
      { action: "round_review_catalog", report, extra: true },
      { action: "round_review_catalog", report: "https://untrusted.example/" },
      { action: "round_review_change", op: { kind: "remove", id: "x" } },
    ])
      expect((await send(body)).status).toBe(403);
    expect(call({ action: "state" })).toEqual(before);
  } finally {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    if (old === undefined) delete process.env.KYOKULOOP_DB;
    else process.env.KYOKULOOP_DB = old;
    if (
      !resolve(folder).startsWith(root + sep) ||
      !basename(folder).startsWith("round-api-")
    )
      throw Error("unsafe fixture cleanup");
    rmSync(folder, { recursive: true });
  }
});
