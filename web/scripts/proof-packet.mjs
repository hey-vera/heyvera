import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function run(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function listFiles(dir, depth, prefix = "") {
  if (depth < 0 || !existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath, depth - 1, relPath));
    } else {
      files.push(relPath);
    }
  }

  return files;
}

function section(title, body) {
  console.log(`\n=== ${title} ===`);
  console.log(body);
}

let buildFailed = false;
let buildOutput = "";

try {
  buildOutput = run("npm", ["run", "build"]);
} catch (error) {
  buildFailed = true;
  buildOutput =
    (error.stdout || "") + (error.stderr ? `\n${error.stderr}` : "");
}

section("pwd", process.cwd());
section("git status -sb", run("git", ["status", "-sb"]));
section("git log --oneline -n 3", run("git", ["log", "--oneline", "-n", "3"]));
section("npm run build", buildOutput.trim() || "(no output)");

const srcDir = path.join(process.cwd(), "src");
section(
  "src files",
  listFiles(srcDir, 3, "src").join("\n") || "(no files found under src)",
);

const appPath = path.join(srcDir, "App.tsx");
section(
  "src/App.tsx",
  existsSync(appPath) ? readFileSync(appPath, "utf8").trimEnd() : "(missing)",
);

if (buildFailed) {
  process.exit(1);
}
