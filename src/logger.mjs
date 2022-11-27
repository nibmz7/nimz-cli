import { nanoid } from "nanoid";
import ansiDiff from "ansi-diff";
import Table from "cli-table3";
import { AsyncLocalStorage } from "node:async_hooks";

const LOADING = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const RENDER_INTERVAL = 100;

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

class LogGroup {
  constructor(id, name) {
    this.name = name;
    this.id = id;
    this.children = [];
    this.logs = [];
  }

  addLog(log) {
    this.logs.push(log);
  }

  addChild(childId) {
    this.children.push(childId);
  }
}

class LogManager {
  constructor() {
    this.roots = {};
    this.groups = {};
    this.storage = new AsyncLocalStorage();
    this.readyToRender = true;
    this.loadingIndex = 0;
    this.differ = ansiDiff();
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
      this.roots[id] = group;
    }
    this.groups[id] = group;
    await this.storage.run(id, () => {
      return fn();
    });
    group.done = true;
    this.printLogs();
  }

  log(message) {
    const scopedGroup = this.getScopedGroup();
    scopedGroup.addLog(message);
    this.printLogs();
  }

  getLogs() {
    const allLogs = [];
    const loading = LOADING[this.incrementLoadingIndex()];
    for (const rootId in this.roots) {
      const root = this.roots[rootId];
      const rootTitle = root.name + " " + (root.done ? "✔" : loading);
      const rootTable = new Table({ head: [rootTitle] });
      const tableStack = [rootTable];
      const idsStack = [root.children.slice()];
      rootTable.push([root.logs.join("\n")]);
      while (idsStack.length > 0) {
        const ids = idsStack[idsStack.length - 1];
        const groupId = ids.shift();
        if (groupId) {
          const group = this.groups[groupId];
          const groupTitle = group.name + " " + (group.done ? "✔" : loading);
          const table = new Table({ head: [groupTitle] });
          table.push([group.logs.join("\n")]);
          tableStack.push(table);
          idsStack.push(group.children.slice());
        } else {
          idsStack.pop();
          const table = tableStack.pop();
          if (tableStack.length > 0) {
            tableStack[tableStack.length - 1].push([table.toString()]);
          }
        }
      }
      allLogs.push(rootTable.toString());
    }
    return allLogs.join("\n");
  }

  printLogs() {
    if (!this.readyToRender) return;
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

export async function withLogManager(fn) {
  const logManager = new LogManager();
  const intervalId = setInterval(() => {
    logManager.printLogs();
  }, RENDER_INTERVAL);
  process.stdout.write(clearScreen());
  await logManagerLocalStorage.run(logManager, () => {
    return fn();
  });
  clearInterval(intervalId);
  process.stdout.write(clearScreen() + logManager.getLogs());
}

export async function withGrouping() {
  const logManager = logManagerLocalStorage.getStore();
  return logManager.withGrouping(...arguments);
}

export function log() {
  const logManager = logManagerLocalStorage.getStore();
  return logManager.log(...arguments);
}
