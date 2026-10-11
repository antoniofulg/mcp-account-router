import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "../dist/router.js";
import { sandbox, upstream, profile, policy, config, result, content } from "./fixtures.mjs";

test("C04 explicit policy", async () => {
  const box = sandbox(),
    provider = await upstream(),
    router = new Router(config(box, [profile(provider.url)]));
  try {
    await Promise.all([
      router.call("fixture.echo", { value: "same" }),
      router.call("fixture.echo", { value: "same" }),
    ]);
    assert.equal(provider.calls.length, 2);
    await router.call("fixture.echo", { value: "same" });
    assert.equal(provider.calls.length, 3);
    assert.deepEqual(readdirSync(router.cacheDir), []);
    assert.equal(router.counters.coalesced, 0);
  } finally {
    await router.close();
    await provider.close();
    box.clean();
  }
});
test("C05 cache boundaries", async () => {
  const box = sandbox(),
    provider = await upstream(),
    routers = [];
  const make = (profiles = [profile(provider.url)], ttl) => {
    const router = new Router(config(box, profiles, { "fixture.echo": policy() }, ttl));
    routers.push(router);
    return router;
  };
  try {
    const router = make();
    assert.equal(router.config.cacheTtlSeconds, 604800);
    await router.call("fixture.echo", { b: 2, a: 1 });
    await router.call("fixture.echo", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 1);
    const file = join(router.cacheDir, readdirSync(router.cacheDir)[0]),
      row = JSON.parse(readFileSync(file));
    assert.ok(row.expiresAt > Date.now() + 604799000);
    row.expiresAt = Date.now();
    writeFileSync(file, JSON.stringify(row));
    await router.call("fixture.echo", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 2);
    writeFileSync(file, "broken");
    await router.call("fixture.echo", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 3);
    await router.call("fixture.echo", { a: 2, b: 2 });
    await router.call("different.tool", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 5);
    const rotated = make([profile(provider.url, "a", { headers: { "X-Profile": "rotated" } })]);
    assert.equal(content(await rotated.call("fixture.echo", { a: 1, b: 2 })).profile, "rotated");
    assert.equal(provider.calls.length, 6);
    box.write({
      different: { profiles: [profile(provider.url)], safeTools: { "fixture.echo": policy() } },
    });
    const { loadConfigurations } = await import("../dist/config.js");
    const realm = new Router(loadConfigurations(box.file, "different")[0]);
    routers.push(realm);
    await realm.call("fixture.echo", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 7);
    const off = make([profile(provider.url)], 0);
    await off.call("fixture.echo", { a: 1, b: 2 });
    await off.call("fixture.echo", { a: 1, b: 2 });
    assert.equal(provider.calls.length, 9);
  } finally {
    await Promise.all(routers.map((router) => router.close()));
    await provider.close();
    box.clean();
  }
});
test("C06 read coalescing", async () => {
  const box = sandbox();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const provider = await upstream(async (call) => {
    await gate;
    return result(call.profile, call.args);
  });
  const router = new Router(
    config(box, [profile(provider.url)], { "fixture.echo": policy({ cache: false }) }),
  );
  try {
    const calls = [
      router.call("fixture.echo", { value: "wait" }),
      router.call("fixture.echo", { value: "wait" }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(provider.calls.length, 1);
    release();
    assert.deepEqual(await calls[0], await calls[1]);
    assert.equal(router.counters.coalesced, 1);
    const secondBox = sandbox();
    const other = new Router(
      config(secondBox, [profile(provider.url, "b")], { "fixture.echo": policy({ cache: false }) }),
    );
    try {
      assert.equal(content(await other.call("fixture.echo", { value: "wait" })).profile, "b");
      assert.equal(provider.calls.length, 2);
    } finally {
      await other.close();
      secondBox.clean();
    }
    provider.set({ httpStatus: 503 });
    await assert.rejects(router.call("fixture.echo", { value: "fail" }));
    provider.set(undefined);
    await router.call("fixture.echo", { value: "fail" });
    assert.equal(provider.calls.length, 4);
  } finally {
    release();
    await router.close();
    await provider.close();
    box.clean();
  }
});
test("C07 quota failover", async () => {
  const box = sandbox(),
    a = await upstream({ httpStatus: 429 }),
    b = await upstream(),
    router = new Router(
      config(box, [profile(a.url, "a"), profile(b.url, "b")], { "fixture.echo": policy() }),
    );
  try {
    assert.equal(content(await router.call("fixture.echo", { value: "quota" })).profile, "b");
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 1);
    await router.call("fixture.echo", { value: "quota" });
    assert.equal(a.calls.length, 2);
    assert.equal(b.calls.length, 1);
    assert.equal(router.counters.cacheHits, 1);
    a.set(async () => ({ content: [{ type: "text", text: "quota exhausted" }], isError: true }));
    await router.call("fixture.echo", { value: "text" });
    assert.equal(a.calls.length, 3);
    assert.equal(b.calls.length, 2);
    b.set({ httpStatus: 429 });
    await assert.rejects(router.call("fixture.echo", { value: "all" }));
    assert.equal(a.calls.length, 4);
    assert.equal(b.calls.length, 3);
  } finally {
    await router.close();
    await a.close();
    await b.close();
    box.clean();
  }
});
test("C08 no unsafe retry", async () => {
  for (const status of [401, 403, 500, 503, 429]) {
    const box = sandbox(),
      a = await upstream({ httpStatus: status, body: "quota exhausted" }),
      b = await upstream(),
      router = new Router(
        config(
          box,
          [profile(a.url, "a"), profile(b.url, "b")],
          status === 429 ? {} : { "fixture.echo": policy() },
        ),
      );
    try {
      await assert.rejects(router.call("fixture.echo"));
      assert.equal(a.calls.length, 1);
      assert.equal(b.calls.length, 0);
    } finally {
      await router.close();
      await a.close();
      await b.close();
      box.clean();
    }
  }
  const box = sandbox(),
    a = await upstream(async () => ({
      content: [{ type: "text", text: "ordinary error" }],
      isError: true,
    })),
    b = await upstream(),
    router = new Router(
      config(box, [profile(a.url, "a"), profile(b.url, "b")], { "fixture.echo": policy() }),
    );
  try {
    assert.equal((await router.call("fixture.echo")).isError, true);
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 0);
    await a.close();
    await assert.rejects(router.call("fixture.echo"));
    assert.equal(b.calls.length, 0);
  } finally {
    await router.close();
    await b.close();
    box.clean();
  }
});
test("C09 failure is not cached", async () => {
  for (const failure of [
    { httpStatus: 503 },
    async () => ({ content: [{ type: "text", text: "failed" }], isError: true }),
  ]) {
    const box = sandbox(),
      provider = await upstream(failure),
      router = new Router(
        config(box, [profile(provider.url)], { "fixture.echo": policy({ failover: false }) }),
      );
    try {
      await router.call("fixture.echo", { value: "same" }).catch(() => {});
      assert.equal(readdirSync(router.cacheDir).length, 0);
      provider.set(undefined);
      await router.call("fixture.echo", { value: "same" });
      assert.equal(provider.calls.length, 2);
      assert.equal(readdirSync(router.cacheDir).length, 1);
    } finally {
      await router.close();
      await provider.close();
      box.clean();
    }
  }
});
