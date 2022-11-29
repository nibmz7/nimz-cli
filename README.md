# nimz-cli

> CLI Logger for Node.JS

Group logs according to their asynchronous context and display nicely in a table format.

## Install

```sh
npm install nimz-cli
```

## Example

![CLI Logger Demo](https://github.com/nibmz7/nimz-cli/blob/main/cli-logger.gif?raw=true)

```js
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
  { saveToFile: true, maxWidth: 100 }
);
```

## API

### withLogManager(fn, options?)

Wrap your code in a `withLogManager` block to enable context logging. This should be the start of your program or code execution path.

#### fn

Type: `Function`

Promise-returning or async function.

#### options

Type: `object`

##### maxLines

Type: `number`\
Default: `5`\

Limit the number of lines to display per log group in the table.

##### maxWidth

Type: `number`\
Default: `process.stdout.columns - 20`

Limit the number of characters to display per line in the table. This does not stop nested tables from overflowing.

##### outputToConsole

Type: `boolean`\
Default: `true`

Should print output to console.

#### saveToFile

Type: `boolean`\
Default: `true`

Should save output to a file.

#### fileOutputPath

Type: `string`\
Default: `path.join(process.cwd(), "logs.txt")`

Specify the path to save the log file.

#### truncateFileOutput

Type: `boolean`\
Default: `false`

Save the log file in truncate mode.

## Related

- [Grouping logs with async local storage](https://nimz.dev/posts/grouping-logs-with-async-local-storage)