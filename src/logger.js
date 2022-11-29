import fs from "fs";
import safeStringify from "@sindresorhus/safe-stringify";
import { nanoid } from "nanoid";
import ansiDiff from "ansi-diff";
import Table from "cli-table3";
import stripAnsi from "strip-ansi";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "path";

const LOADING = [
  "[    ]",
  "[=   ]",
  "[==  ]",
  "[=== ]",
  "[ ===]",
  "[  ==]",
  "[   =]",
  "[    ]",
  "[   =]",
  "[  ==]",
  "[ ===]",
  "[====]",
  "[=== ]",
  "[==  ]",
  "[=   ]",
];

const RENDER_INTERVAL = 70;

function clearToBeginningOfScreen() {
  return "\x1b[1J";
}

function clearScrollback() {
  return "\x1b[3J";
}

function moveCursor(x, y) {
  return `\x1b[${y};${x}H`;
}

function clearScreen() {
  return clearToBeginningOfScreen() + clearScrollback() + moveCursor(0, 0);
}

function hideCursor() {
  return "\x1b[?25l";
}

function showCursor() {
  return "\x1b[?25h";
}

function yellow(text) {
  return `\x1b[33m${text}\x1b[39m`;
}

const asciiChars = {
  top: "-",
  "top-mid": "+",
  "top-left": "+",
  "top-right": "+",
  bottom: "-",
  "bottom-mid": "+",
  "bottom-left": "+",
  "bottom-right": "+",
  left: "|",
  "left-mid": "|",
  right: "|",
  "right-mid": "|",
};

function getLines(m) {
  return typeof m === "string"
    ? m.split("\n")
    : safeStringify(m, { indentation: "\t" })
        .split("\n")
        .map((n) => n.replace(/\t/g, "  "));
}

class LogGroup {
  constructor(id, name) {
    this.name = name;
    this.id = id;
    this.children = [];
    this.lines = [];
    this.finishedLines = [];
    this.done = false;
  }

  addLog(m) {
    this.lines.push(...getLines(m));
  }

  addFinishedLogs(m) {
    const lines = getLines(m);
    this.lines.push(...lines);
    this.finishedLines.push(...lines);
  }

  addChild(childId) {
    this.children.push(childId);
  }
}

function truncateText(t, maxWidth) {
  return t.length > maxWidth ? t.slice(0, 80) + "..." : t;
}

class LogManager {
  constructor({ maxLines, maxWidth, outputToConsole }) {
    this.roots = [];
    this.groups = {};
    this.storage = new AsyncLocalStorage();
    this.readyToRender = true;
    this.loadingIndex = 0;
    this.differ = ansiDiff();
    this.maxLines = maxLines;
    this.outputToConsole = outputToConsole;
    this.maxWidth = maxWidth;
  }

  incrementLoadingIndex() {
    const _loadingIndex = this.loadingIndex;
    this.loadingIndex = (this.loadingIndex + 1) % LOADING.length;
    return _loadingIndex;
  }

  getScopedGroup() {
    const id = this.storage.getStore();
    return this.groups[id];
  }

  async withGrouping(name, fn) {
    const id = nanoid();
    const group = new LogGroup(id, name);
    const parent = this.getScopedGroup();
    if (parent) {
      parent.children.push(id);
    } else {
      this.roots.push(id);
    }
    this.groups[id] = group;
    await this.storage.run(id, () => {
      return fn();
    });
    group.done = true;
    this.printLogs();
  }

  log(...messages) {
    const scopedGroup = this.getScopedGroup();
    for (const message of messages) {
      scopedGroup.addLog(message);
    }
    this.printLogs();
  }

  logFinished(...messages) {
    const scopedGroup = this.getScopedGroup();
    for (const message of messages) {
      scopedGroup.addFinishedLogs(message);
    }
    this.printLogs();
  }

  getLogs({ chars = {}, truncateLogs = true } = {}) {
    const allLogs = [];
    const loading = LOADING[this.incrementLoadingIndex()];
    const tableStack = [];
    const idsStack = [[...this.roots]];
    while (idsStack.length > 0) {
      const ids = idsStack[idsStack.length - 1];
      const groupId = ids.shift();
      if (groupId) {
        const group = this.groups[groupId];
        const groupTitle = group.name + " " + (group.done ? "✔" : loading);
        const table = new Table({ head: [groupTitle], chars });
        const lines =
          truncateLogs && group.done && group.finishedLines.length > 0
            ? group.finishedLines
            : group.lines;
        const truncateLineText =
          lines.length > this.maxLines && truncateLogs
            ? yellow(`${lines.length - this.maxLines} lines truncated...\n`)
            : "";
        const logs = truncateLogs ? lines.slice(-this.maxLines) : lines;
        table.push([
          truncateLineText +
            logs
              .map((x) => {
                return truncateLogs ? truncateText(x, this.maxWidth) : x;
              })
              .join("\n"),
        ]);
        tableStack.push(table);
        idsStack.push(group.children.slice());
      } else {
        idsStack.pop();
        const table = tableStack.pop();
        if (tableStack.length > 0) {
          tableStack[tableStack.length - 1].push([table.toString()]);
        } else if (tableStack.length === 0 && table) {
          allLogs.push(table.toString());
        }
      }
    }
    return allLogs.join("\n");
  }

  printLogs() {
    if (!this.readyToRender || !this.outputToConsole) return;
    this.readyToRender = false;
    const text = this.differ.update(this.getLogs());
    process.stdout.write(text, () => {
      setTimeout(() => {
        this.readyToRender = true;
      }, RENDER_INTERVAL);
    });
  }
}

const logManagerLocalStorage = new AsyncLocalStorage();

export async function withLogManager(
  fn,
  {
    maxLines = 5,
    saveToFile = false,
    fileOutputPath = path.join(process.cwd(), "logs.txt"),
    outputToConsole = true,
    truncateFileOutput = false,
    maxWidth = process.stdout.columns - 20,
  } = {}
) {
  const logManager = new LogManager({ maxLines, maxWidth, outputToConsole });
  let intervalId;
  if (outputToConsole) {
    process.stdout.write(hideCursor() + clearScreen() + "\n");
    intervalId = setInterval(() => {
      logManager.printLogs();
    }, RENDER_INTERVAL);
  }
  await logManagerLocalStorage.run(logManager, () => {
    return fn();
  });
  if (intervalId) clearInterval(intervalId);
  if (outputToConsole) {
    const logs = logManager.getLogs();
    process.stdout.write(clearScreen() + "\n" + logs);
    if (saveToFile) {
      process.stdout.write(
        "\n\nLogs will be saved to " + fileOutputPath + "\n"
      );
    }
    process.stdout.write(showCursor());
  }

  if (saveToFile) {
    const finalLogs = logManager.getLogs({
      chars: asciiChars,
      truncateLogs: truncateFileOutput,
    });
    await fs.promises.writeFile(fileOutputPath, stripAnsi(finalLogs));
  }
}

export async function withGrouping() {
  const logManager = logManagerLocalStorage.getStore();
  return logManager.withGrouping(...arguments);
}

export function log() {
  const logManager = logManagerLocalStorage.getStore();
  return logManager.log(...arguments);
}

export function logFinished() {
  const logManager = logManagerLocalStorage.getStore();
  return logManager.logFinished(...arguments);
}
