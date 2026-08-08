#!/usr/bin/env node
/**
 * worktree-report.mjs — сводка параллельной работы для роли `lead`.
 *
 * Запуск: node scripts/worktree-report.mjs
 *
 * Отвечает на вопросы, ради которых заводится организатор:
 *   - что сейчас в работе и насколько каждая ветка отстала от `main`
 *     (отставание — главная причина «потом сложно совместить»);
 *   - какие файлы трогают ДВЕ И БОЛЕЕ веток одновременно: это будущий
 *     конфликт, и увидеть его надо до влития, а не в момент мержа;
 *   - что уже влито и подлежит сносу, а что живёт без дерева.
 *
 * Только чтение: ни одна команда здесь не меняет репозиторий.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const git = (...args) => {
  try {
    return execFileSync("git", ["-C", REPO, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
};

const lines = (s) => (s ? s.split(/\r?\n/).filter(Boolean) : []);

/** Деревья: `git worktree list --porcelain` → { path, branch }. */
function worktrees() {
  const out = [];
  let current = {};
  for (const line of lines(git("worktree", "list", "--porcelain"))) {
    if (line.startsWith("worktree ")) current = { path: line.slice(9) };
    else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
      out.push(current);
    } else if (line === "detached") out.push(current);
  }
  return out;
}

const mainSha = git("rev-parse", "--short", "main");
const trees = worktrees();
const treeByBranch = new Map(trees.filter((t) => t.branch).map((t) => [t.branch, t.path]));

const unmerged = lines(git("branch", "--no-merged", "main", "--format=%(refname:short)"));
const merged = lines(git("branch", "--merged", "main", "--format=%(refname:short)")).filter(
  (b) => b !== "main"
);

console.log(`База: main @ ${mainSha}\n`);

// --- Что в работе -----------------------------------------------------------
const rows = [];
for (const branch of unmerged) {
  const counts = git("rev-list", "--left-right", "--count", `main...${branch}`).split(/\s+/);
  const behind = Number(counts[0] ?? 0);
  const ahead = Number(counts[1] ?? 0);
  const tree = treeByBranch.get(branch);
  const dirty = tree ? lines(git("-C", tree, "status", "--porcelain")).length : 0;
  rows.push({
    branch,
    ahead,
    behind,
    dirty,
    tree: tree ? path.basename(tree) : "—",
    last: git("log", "-1", "--format=%ad", "--date=short", branch),
  });
}
rows.sort((a, b) => b.behind - a.behind);

console.log(`В работе (не влито в main): ${rows.length}`);
if (rows.length) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `  ${pad("ветка", 38)}${pad("вперёд", 8)}${pad("отстала", 9)}${pad("грязное", 9)}${pad("дерево", 24)}посл. коммит`
  );
  for (const r of rows) {
    console.log(
      `  ${pad(r.branch, 38)}${pad("+" + r.ahead, 8)}${pad("-" + r.behind, 9)}` +
        `${pad(r.dirty ? `${r.dirty} файлов` : "чисто", 9)}${pad(r.tree, 24)}${r.last}`
    );
  }
}

// --- Пересечения файлов -----------------------------------------------------
// Файл, который трогают две ветки, — это будущий конфликт ИЛИ два несовместимых
// решения об одном и том же. Второе опаснее: git его не покажет.
const owners = new Map();
for (const r of rows) {
  for (const file of lines(git("diff", "--name-only", `main...${r.branch}`))) {
    if (!owners.has(file)) owners.set(file, []);
    owners.get(file).push(r.branch);
  }
}
const shared = [...owners.entries()].filter(([, bs]) => bs.length > 1);
shared.sort((a, b) => b[1].length - a[1].length);

console.log(`\nОбщие файлы у нескольких веток: ${shared.length}`);
for (const [file, branches] of shared.slice(0, 25)) {
  console.log(`  ${file}\n      ← ${branches.join(", ")}`);
}
if (shared.length > 25) console.log(`  … ещё ${shared.length - 25}`);

// --- Мусор ------------------------------------------------------------------
const staleTrees = trees.filter((t) => t.branch && merged.includes(t.branch));
console.log(`\nДеревья с уже влитой веткой (подлежат сносу): ${staleTrees.length}`);
for (const t of staleTrees) console.log(`  ${path.basename(t.path)}  (${t.branch})`);

const orphanBranches = rows.filter((r) => r.tree === "—");
console.log(`\nНевлитые ветки без дерева: ${orphanBranches.length}`);
for (const r of orphanBranches.slice(0, 20)) console.log(`  ${r.branch}  (посл. ${r.last})`);
if (orphanBranches.length > 20) console.log(`  … ещё ${orphanBranches.length - 20}`);
