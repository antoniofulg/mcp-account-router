import test from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  symlinkSync,
  statSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { loadConfigurations } from "../dist/config.js";
import { Router } from "../dist/router.js";
import { privateDir, readPrivate, writePrivate } from "../dist/files.js";
import { paths, readState } from "../dist/daemon.js";
import {
  sandbox,
  upstream,
  profile,
  policy,
  config,
  cli,
  cliClient,
  stop,
  content,
  result,
} from "./fixtures.mjs";

test("C10 configuration and status", async () => {
  const box = sandbox(),
    provider = await upstream(),
    env = {
      ...process.env,
      ROUTER_TEST_SECRET: "opaque-SYNTHETIC_A_credential",
      UNSELECTED_SECRET: "opaque-SYNTHETIC_B_credential",
    };
  try {
    const invalids = [
      { version: 2, servers: {} },
      { version: 1, servers: { fixture: { profiles: [] } } },
      { version: 1, servers: { fixture: { profiles: [{ name: "bad", transport: "unknown" }] } } },
      {
        version: 1,
        servers: {
          fixture: { profiles: [profile(provider.url)], safeTools: { write: { readOnly: false } } },
        },
      },
      {
        version: 1,
        servers: {
          fixture: {
            profiles: [
              profile(provider.url, "a", {
                headers: { Authorization: { env: "INTENTIONALLY_MISSING_ENV" } },
              }),
            ],
          },
        },
      },
    ];
    for (const value of invalids) {
      writeFileSync(box.file, JSON.stringify(value), { mode: 0o600 });
      for (const command of ["validate", "connect"]) {
        const result = cli(box.file, command);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
      }
    }
    assert.equal(provider.requests.length, 0);
    for (const args of [
      [],
      ["connect"],
      ["status", "--config", box.file],
      ["stop", "--server", "fixture"],
    ])
      assert.equal(
        spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" }).status,
        1,
      );
    box.write({
      fixture: {
        profiles: [
          profile(provider.url, "a", {
            headers: {
              "X-Profile": "a",
              Authorization: { env: "ROUTER_TEST_SECRET", prefix: "Bearer " },
            },
          }),
        ],
      },
    });
    assert.equal(cli(box.file, "validate", "fixture", env).status, 0);
    const before = provider.requests.length;
    const offline = cli(box.file, "status", "fixture", env);
    assert.equal(offline.status, 0);
    assert.deepEqual(JSON.parse(offline.stdout), { running: false, server: "fixture" });
    assert.equal(provider.requests.length, before);
    box.write({
      fixture: {
        profiles: [
          {
            name: "stdio",
            transport: "stdio",
            command: process.execPath,
            args: [resolve("test/stdio-fixture.mjs")],
            env: { PROFILE: { env: "ROUTER_TEST_SECRET" } },
          },
        ],
      },
      unselected: {
        profiles: [
          profile(provider.url, "other", {
            headers: { Authorization: { env: "UNRESOLVED_OTHER_CREDENTIAL" } },
          }),
        ],
      },
    });
    const previous = process.env.ROUTER_TEST_SECRET,
      other = process.env.UNSELECTED_SECRET;
    process.env.ROUTER_TEST_SECRET = env.ROUTER_TEST_SECRET;
    process.env.UNSELECTED_SECRET = env.UNSELECTED_SECRET;
    let consumer;
    try {
      consumer = await cliClient(box.file);
      const value = content(await consumer.client.callTool({ name: "fixture.echo" }));
      assert.equal(value.profile, env.ROUTER_TEST_SECRET);
      assert.equal(value.other, null);
      const status = cli(box.file);
      assert.equal(status.status, 0);
      assert.ok(!status.stdout.includes(env.ROUTER_TEST_SECRET));
      assert.ok(!status.stdout.includes("token"));
    } finally {
      await consumer?.close();
      await stop(box.file);
      if (previous === undefined) delete process.env.ROUTER_TEST_SECRET;
      else process.env.ROUTER_TEST_SECRET = previous;
      if (other === undefined) delete process.env.UNSELECTED_SECRET;
      else process.env.UNSELECTED_SECRET = other;
    }
  } finally {
    await provider.close();
    box.clean();
  }
});
test("C11 private filesystem", async () => {
  const box = sandbox(),
    provider = await upstream(),
    previous = process.env.ROUTER_FS_CANARY;
  let router;
  process.env.ROUTER_FS_CANARY = "opaque-SYNTHETIC_FS_credential";
  try {
    const ordinary = join(box.root, "private");
    privateDir(ordinary);
    const file = join(ordinary, "state.json");
    writePrivate(file, { safe: true });
    assert.equal(statSync(ordinary).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const target = join(box.root, "sentinel");
    writeFileSync(target, "untouched", { mode: 0o600 });
    const link = join(ordinary, "link.json");
    symlinkSync(target, link);
    assert.throws(() => readPrivate(link));
    assert.throws(() => writePrivate(link, { bad: true }));
    assert.equal(readFileSync(target, "utf8"), "untouched");
    const parent = join(box.root, "parent-link");
    symlinkSync(ordinary, parent);
    assert.throws(() => privateDir(join(parent, "nested")));
    assert.equal(readdirSync(ordinary).includes("nested"), false);
    symlinkSync(target, box.file);
    assert.throws(() => loadConfigurations(box.file));
    unlinkSync(box.file);
    const resolved = config(
      box,
      [
        profile(provider.url, "a", {
          headers: {
            "X-Profile": "a",
            Authorization: { env: "ROUTER_FS_CANARY", prefix: "Bearer " },
          },
        }),
      ],
      { "fixture.echo": policy() },
    );
    router = new Router(resolved);
    await router.call("fixture.echo", { value: "ordinary" });
    const record = join(router.cacheDir, readdirSync(router.cacheDir)[0]);
    assert.equal(statSync(router.cacheDir).mode & 0o777, 0o700);
    assert.equal(statSync(record).mode & 0o777, 0o600);
    assert.ok(!record.includes(process.env.ROUTER_FS_CANARY));
    assert.ok(!readFileSync(record, "utf8").includes(process.env.ROUTER_FS_CANARY));
    unlinkSync(record);
    symlinkSync(target, record);
    await assert.rejects(router.call("fixture.echo", { value: "ordinary" }));
    assert.equal(readFileSync(target, "utf8"), "untouched");
    unlinkSync(record);
    const token = paths(resolved).state;
    symlinkSync(target, token);
    assert.throws(() => readState(token));
    assert.throws(() => writePrivate(token, { bad: true }));
    assert.equal(readFileSync(target, "utf8"), "untouched");
    provider.set(async () => ({
      ...result("a"),
      structuredContent: { reflected: process.env.ROUTER_FS_CANARY },
    }));
    await router.call("fixture.echo", { value: "reflect" });
    assert.deepEqual(readdirSync(router.cacheDir), []);
  } finally {
    await router?.close();
    await provider.close();
    box.clean();
    if (previous === undefined) delete process.env.ROUTER_FS_CANARY;
    else process.env.ROUTER_FS_CANARY = previous;
  }
});
test("C14 public package", async () => {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
  )[0].files.map((file) => file.path);
  assert.ok(packed.includes("dist/cli.js"));
  assert.ok(packed.includes("LICENSE"));
  assert.ok(packed.includes("THIRD_PARTY_NOTICES.md"));
  assert.ok(
    packed.every(
      (file) =>
        file === "package.json" ||
        file === "README.md" ||
        file === "ROADMAP.md" ||
        file === "LICENSE" ||
        file === "THIRD_PARTY_NOTICES.md" ||
        file.startsWith("dist/") ||
        file.startsWith("examples/"),
    ),
  );
  assert.ok(
    packed.every(
      (file) => !/(?:\.env|\.log|connection\.json|accounts\.json|node_modules|\.specs)/.test(file),
    ),
  );
  const example = JSON.parse(readFileSync("examples/router.json"));
  assert.equal(example.servers.docs.profiles[0].headers.Authorization.env, "DOCS_ACCOUNT_A_TOKEN");
  const history = execFileSync("git", ["log", "-p", "--all"], { encoding: "utf8" });
  assert.ok(!/ctx7sk-[a-f0-9-]{20,}/i.test(history));
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(history));
  const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
  assert.ok(notices.includes("Mirsella"));
  assert.ok(notices.includes("Permission is hereby granted"));
});
