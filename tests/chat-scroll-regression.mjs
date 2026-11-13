import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const chromeBinary = process.env.CHROME_BIN || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "google-chrome");
const harnessUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "chat-scroll-harness.html"),
);
if (process.argv[2]) harnessUrl.searchParams.set("case", process.argv[2]);
const profileDir = await mkdtemp(join(tmpdir(), "chatty-scroll-test-"));
const chrome = spawn(chromeBinary, [
  "--headless",
  "--disable-gpu",
  "--allow-file-access-from-files",
  "--disable-background-networking",
  "--no-first-run",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  harnessUrl.href,
], { stdio: ["ignore", "ignore", "pipe"] });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let launchError;
chrome.on("error", (error) => { launchError = error; });

async function devtoolsPort() {
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) return Number(match[1]);
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error(`Chrome exited before DevTools started (${chrome.exitCode ?? chrome.signalCode})`);
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for Chrome DevTools");
}

async function pageSocket(port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await delay(25);
  }
  throw new Error("Timed out waiting for the harness page");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

let nextCommandId = 0;
function evaluate(socket, expression) {
  return new Promise((resolve, reject) => {
    const id = ++nextCommandId;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result.result.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true },
    }));
  });
}

let socket;
try {
  const port = await devtoolsPort();
  socket = await connect(await pageSocket(port));
  const deadline = Date.now() + 8000;
  let result;
  while (Date.now() < deadline) {
    result = await evaluate(
      socket,
      `(() => {
        const node = document.querySelector("#result");
        return { status: node?.dataset.status, text: node?.textContent };
      })()`,
    );
    if (result?.status && result.status !== "pending") break;
    await delay(50);
  }

  assert.equal(result?.status, "pass", result?.text || "Harness did not finish");
  console.log(result.text);
} finally {
  socket?.close();
  if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, delay(1000)]);
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGKILL");
      await exited;
    }
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
