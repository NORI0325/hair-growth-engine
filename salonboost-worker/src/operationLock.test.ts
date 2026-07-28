import assert from "node:assert/strict";
import test from "node:test";
import { withOperationLock } from "./operationLock.js";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serializes operations for the same location", async () => {
  let active = 0;
  let maximumActive = 0;
  const order: number[] = [];
  const run = (value: number) => withOperationLock("owner:location", async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(5);
    order.push(value);
    active -= 1;
  });

  await Promise.all([run(1), run(2), run(3)]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [1, 2, 3]);
});

test("does not block independent locations", async () => {
  let active = 0;
  let maximumActive = 0;
  const run = (key: string) => withOperationLock(key, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(5);
    active -= 1;
  });

  await Promise.all([run("owner:a"), run("owner:b")]);
  assert.equal(maximumActive, 2);
});
