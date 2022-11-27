import delay from "delay";
import { log, withGrouping, withLogManager } from "./logger.mjs";

function randomMs() {
  return Math.random() * 1000;
}

async function doSomething3() {
  log("doSomething-3");
  await delay(randomMs());
  for (let i = 0; i < 3; i++) {
    log("doSomething-33" + i);
    log("doSomething-333" + i);
  }
}

async function doSomething2() {
  log("doSomething-2");
  await delay(randomMs());
  log("doSomething-22");
  await withGrouping("d", doSomething3);
  log("doSomething-222");
}

withLogManager(async () => {
  await withGrouping("a", async () => {
    log("doSomething-1-a start");
    await delay(randomMs());
    await withGrouping("b", doSomething2);
    await withGrouping("c", doSomething2);
    await delay(randomMs());
    log("doSomething-1-a end");
  });

  await withGrouping("b", async () => {
    log("doSomething-1-b start");
    await delay(randomMs());
    await withGrouping("b", doSomething2);
    await withGrouping("c", doSomething2);
    await delay(randomMs());
    log("doSomething-1-b end");
  });
});
