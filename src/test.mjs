import delay from "delay";
import randomWords from "random-words";
import { log, logFinished, withGrouping, withLogManager } from "./logger.js";

function randomMs() {
  return Math.random() * 1000;
}

async function doSomething3() {
  log("doSomething-3");
  for (let i = 0; i < 10; i++) {
    log("doSomething-33 " + randomWords(5));
    await delay(randomMs());
    log("doSomething-333 " + randomWords(20));
  }
}

async function doSomething2() {
  log("doSomething-2");
  await delay(randomMs());
  log("doSomething-22");
  await withGrouping("d", doSomething3);
  log("doSomething-222");
  logFinished("You're all set!", randomWords(5).join(" "));
}

withLogManager(
  async () => {
    await withGrouping("a", async () => {
      log("doSomething-1-a start");
      await delay(randomMs());
      await Promise.all([
        withGrouping("b", doSomething2),
        withGrouping("c", doSomething2),
      ]);
      await delay(randomMs());
      log("doSomething-1-a end");
    });
  },
  { maxWidth: 100, saveToFile: true }
  // { saveToFile: true, maxWidth: 100 }
  // { isCI: true, maxWidth: 100 }
);

// withLogManager(
//   async () => {
//     await withGrouping("a", async () => {
//       log("doSomething-1-a start");
//       await delay(randomMs());
//       await Promise.all([
//         withGrouping("b", doSomething2),
//         withGrouping("c", doSomething2),
//       ]);
//       await delay(randomMs());
//       log("doSomething-1-a end");
//     });
//   },
//   { maxWidth: 100, printFinalOutputOnly: true }
//   // { saveToFile: true, maxWidth: 100 }
//   // { isCI: true, maxWidth: 100 }
// );
