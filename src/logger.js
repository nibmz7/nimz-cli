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

class GroupError extends Error {
  constructor(message) {
    super(message);
    this.name = "Group error";
  }
}

class LogManager {
  constructor({ maxLines, maxWidth, disableTerminalOutput }) {
    this.roots = [];
    this.groups = {};
    this.storage = new AsyncLocalStorage();
    this.readyToRender = true;
    this.loadingIndex = 0;
    this.differ = ansiDiff();
    this.maxLines = maxLines;
    this.disableTerminalOutput = disableTerminalOutput;
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
    try {
      const result = await this.storage.run(id, () => {
        return fn();
      });
      group.done = true;
      return result;
    } catch (error) {
      if (error instanceof GroupError) {
        group.childError = true;
        throw error;
      }
      group.error = error.stack;
      throw new GroupError(error.message);
    } finally {
      this.printLogs();
    }
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
        if (group.error) {
          const groupTitle = group.name + " " + "???";
          const table = new Table({ head: [groupTitle], chars });
          table.push([yellow(group.error)]);
          tableStack.push(table);
        } else {
          const status = group.childError ? "???" : group.done ? "???" : loading;
          const groupTitle = group.name + " " + status;
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
        }
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
    if (!this.readyToRender || this.disableTerminalOutput) return;
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
    printAsciiTable = false,
    printFinalOutputOnly = false,
    maxLines = 5,
    saveToFile = false,
    fileOutputPath = path.join(process.cwd(), "logs.txt"),
    disableTerminalOutput = false,
    truncateFileOutput = false,
    maxWidth = process.stdout.columns - 20,
  } = {}
) {
  let intervalId;
  const logManager = new LogManager({
    maxLines,
    maxWidth,
    disableTerminalOutput: disableTerminalOutput || printFinalOutputOnly,
  });

  if (!disableTerminalOutput && !printFinalOutputOnly) {
    process.stdout.write(hideCursor() + clearScreen() + "\n");
    intervalId = setInterval(() => {
      logManager.printLogs();
    }, RENDER_INTERVAL);
  }

  let result;
  let error;

  try {
    result = await logManagerLocalStorage.run(logManager, () => {
      return fn();
    });
  } catch (e) {
    error = e;
  }

  logManager.disableTerminalOutput = true;

  if (intervalId) clearInterval(intervalId);

  if (!disableTerminalOutput) {
    const logs = logManager.getLogs({
      chars: printAsciiTable ? asciiChars : {},
    });
    process.stdout.write(
      (printFinalOutputOnly ? "" : clearScreen()) +
        "\n" +
        logs +
        "\n" +
        showCursor()
    );
  }

  if (saveToFile) {
    process.stdout.write("\n\nLogs will be saved to " + fileOutputPath + "\n");
    const finalLogs = logManager.getLogs({
      chars: asciiChars,
      truncateLogs: truncateFileOutput,
    });
    await fs.promises.writeFile(fileOutputPath, stripAnsi(finalLogs));
  }

  if (error) {
    process.stdout.write("\n\n");
    throw error;
  }

  return result;
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
