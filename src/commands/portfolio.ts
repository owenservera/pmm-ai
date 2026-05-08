/**
 * PMM Portfolio Commands
 * ======================
 * roadmap, node, product — all operate on portfolio_nodes hierarchy
 * with recursive CTE tree traversal.
 */
import type { Database } from "bun:sqlite";
import { getProjectId, getProjectIdOrFail, queryAll, queryOne, run } from "../db";
import { table, requireArgs } from "./shared";

export const commands: Record<string, (db: Database, args: string[]) => Promise<void>> = {

  // ═══ roadmap ═════════════════════════════════════════
  "roadmap:create": async (db, args) => {
    requireArgs(1, '<name> [--type initiative|workstream] [--parent <id>] [--description "..."] [--target YYYY-MM-DD] [--goals "..."]', "roadmap", "create", args);
    const name = args[0]!;
    let type = "workstream", parentId: number | null = null, description: string | null = null, targetDate: string | null = null, goals: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--type" && args[i + 1]) type = args[++i]!;
      else if (args[i] === "--parent" && args[i + 1]) parentId = parseInt(args[++i]!);
      else if (args[i] === "--description" && args[i + 1]) description = args[++i]!;
      else if (args[i] === "--target" && args[i + 1]) targetDate = args[++i]!;
      else if (args[i] === "--goals" && args[i + 1]) goals = args[++i]!;
    }
    run(db, "INSERT INTO portfolio_nodes (parent_id, type, name, description, target_date, goals, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      [parentId, type, name, description, targetDate, goals]);
    const created = queryOne(db, "SELECT id FROM portfolio_nodes ORDER BY id DESC LIMIT 1") as any;
    console.log(`Created ${type} #${created.id}: ${name}`);
  },

  "roadmap:list": async (db, args) => {
    let filter = "";
    const params: any[] = [];
    let format = "table";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--parent" && args[i + 1]) { filter += " AND parent_id = ?"; params.push(parseInt(args[++i]!)); }
      else if (args[i] === "--status" && args[i + 1]) { filter += " AND status = ?"; params.push(args[++i]!); }
      else if (args[i] === "--type" && args[i + 1]) { filter += " AND type = ?"; params.push(args[++i]!); }
      else if (args[i] === "--roots") { filter += " AND parent_id IS NULL"; }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT n.*, COUNT(pj.id) AS project_count FROM portfolio_nodes n LEFT JOIN projects pj ON n.id = pj.node_id WHERE 1=1 ${filter} GROUP BY n.id ORDER BY n.parent_id NULLS FIRST, n.sort_order, n.id`, params);
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log("No nodes found"); return; }
    table(["ID", "Type", "Name", "Status", "Parent", "Projects"], rows.map((r: any) => [String(r.id), r.type, r.name, r.status, r.parent_id ? `#${r.parent_id}` : "—", String(r.project_count)]));
  },

  "roadmap:get": async (db, args) => {
    requireArgs(1, "<id>", "roadmap", "get", args);
    const id = parseInt(args[0]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const node = queryOne(db, "SELECT * FROM portfolio_nodes WHERE id = ?", [id]) as any;
    if (!node) { console.log(`Node #${id} not found`); return; }
    console.log(`  ID:          ${node.id}`);
    console.log(`  Type:        ${node.type}`);
    console.log(`  Name:        ${node.name}`);
    console.log(`  Status:      ${node.status}`);
    console.log(`  Parent:      ${node.parent_id ? `#${node.parent_id}` : "(root)"}`);
    console.log(`  Description: ${node.description || "—"}`);
    if (node.goals) console.log(`  Goals:       ${node.goals}`);
    const children = queryAll(db, "SELECT id, type, name, status FROM portfolio_nodes WHERE parent_id = ? ORDER BY sort_order, id", [id]);
    if (children.length) { console.log(`\n  Children (${children.length}):`); for (const c of children) console.log(`    #${c.id} [${c.type}] ${c.name} (${c.status})`); }
    const projs = queryAll(db, "SELECT name, phase, health FROM projects WHERE node_id = ? ORDER BY name", [id]);
    if (projs.length) { console.log(`\n  Projects (${projs.length}):`); for (const p of projs) console.log(`    ${p.name} | ${p.phase} | ${p.health}`); }
  },

  "roadmap:tree": async (db, args) => {
    let fullTree = false, rootId: number | null = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--full") fullTree = true;
      else if (!rootId && args[i]) { rootId = parseInt(args[i]!); if (isNaN(rootId)) { console.log("Invalid ID"); return; } }
    }
    let rows: any[];
    if (rootId || fullTree) {
      rows = queryAll(db, `WITH RECURSIVE subtree AS (SELECT id, parent_id, type, name, status, sort_order, printf('%06d', id) AS sort_path, 0 AS depth FROM portfolio_nodes WHERE ${rootId ? "id = ?" : "parent_id IS NULL"} UNION ALL SELECT n.id, n.parent_id, n.type, n.name, n.status, n.sort_order, s.sort_path || '/' || printf('%06d', n.id), s.depth + 1 FROM portfolio_nodes n JOIN subtree s ON n.parent_id = s.id) SELECT s.*, p.name AS project_name FROM subtree s LEFT JOIN projects p ON s.id = p.node_id ORDER BY s.sort_path, p.name`, rootId ? [rootId] : []);
    } else {
      rows = queryAll(db, `SELECT n.*, p.name AS project_name FROM portfolio_nodes n LEFT JOIN projects p ON n.id = p.node_id WHERE n.parent_id IS NULL ORDER BY n.sort_order, n.id, p.name`);
    }
    if (!rows.length) { console.log("No nodes found"); return; }
    let lastId = -1;
    for (const r of rows) {
      const depth = r.depth ?? 0;
      if (r.id !== lastId) {
        if (lastId !== -1) console.log("");
        const indent = "  ".repeat(depth);
        const icon = r.type === "product" ? "▣" : r.type === "component" ? "▸" : r.type === "roadmap" ? "▣" : r.type === "initiative" ? "◆" : "▸";
        console.log(`${indent}${icon} #${r.id} [${r.type}] ${r.name} (${r.status})`);
        lastId = r.id;
      }
      if (r.project_name) console.log(`${"  ".repeat(depth + 1)}· ${r.project_name}`);
    }
  },

  "roadmap:update": async (db, args) => {
    requireArgs(1, '<id> [--name "..."] [--status <s>] [--description "..."] [--target <date>] [--goals "..."] [--sort-order <n>]', "roadmap", "update", args);
    const id = parseInt(args[0]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const existing = queryOne(db, "SELECT id FROM portfolio_nodes WHERE id = ?", [id]);
    if (!existing) { console.log(`Node #${id} not found`); return; }
    const sets: string[] = [], vals: any[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--name" && args[i + 1]) { sets.push("name = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--status" && args[i + 1]) { sets.push("status = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--description" && args[i + 1]) { sets.push("description = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--target" && args[i + 1]) { sets.push("target_date = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--goals" && args[i + 1]) { sets.push("goals = ?"); vals.push(args[++i]!); }
      else if (args[i] === "--sort-order" && args[i + 1]) { sets.push("sort_order = ?"); vals.push(parseInt(args[++i]!)); }
    }
    if (!sets.length) { console.log("No fields to update"); return; }
    vals.push(id);
    run(db, `UPDATE portfolio_nodes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, vals);
    console.log(`Updated node #${id}`);
  },

  "roadmap:link": async (db, args) => {
    requireArgs(2, "<node-id> <project>", "roadmap", "link", args);
    const nodeId = parseInt(args[0]!); const projectName = args[1]!;
    if (isNaN(nodeId)) { console.log("Invalid node ID"); return; }
    const node = queryOne(db, "SELECT id FROM portfolio_nodes WHERE id = ?", [nodeId]);
    if (!node) { console.log(`Node #${nodeId} not found`); return; }
    const pid = getProjectIdOrFail(db, projectName);
    run(db, "UPDATE projects SET node_id = ?, updated_at = datetime('now') WHERE id = ?", [nodeId, pid]);
    console.log(`Linked ${projectName} → node #${nodeId}`);
  },

  "roadmap:unlink": async (db, args) => {
    requireArgs(1, "<project>", "roadmap", "unlink", args);
    const projectName = args[0]!;
    const pid = getProjectIdOrFail(db, projectName);
    run(db, "UPDATE projects SET node_id = NULL, updated_at = datetime('now') WHERE id = ?", [pid]);
    console.log(`Unlinked ${projectName}`);
  },

  "roadmap:health": async (db, args) => {
    let nodeId: number | null = null;
    for (let i = 0; i < args.length; i++) { const n = parseInt(args[i]!); if (!isNaN(n)) nodeId = n; }
    let rows: any[];
    if (nodeId) {
      rows = queryAll(db, `WITH RECURSIVE subtree AS (SELECT id FROM portfolio_nodes WHERE id = ? UNION ALL SELECT n.id FROM portfolio_nodes n JOIN subtree s ON n.parent_id = s.id) SELECT p.name, p.phase, p.priority, p.health FROM projects p WHERE p.node_id IN (SELECT id FROM subtree) ORDER BY p.health, p.priority`, [nodeId]);
    } else {
      rows = queryAll(db, "SELECT name, phase, priority, health FROM projects WHERE node_id IS NOT NULL ORDER BY health, priority");
    }
    if (!rows.length) { console.log("No linked projects found"); return; }
    const healthy = rows.filter((r: any) => r.health === "healthy").length;
    const attention = rows.filter((r: any) => r.health === "attention").length;
    const blocked = rows.filter((r: any) => r.health === "blocked").length;
    console.log(`Subtree Health: ${rows.length} projects | ${healthy} healthy | ${attention} attention | ${blocked} blocked`);
    for (const r of rows) {
      const icon = r.health === "healthy" ? "✓" : r.health === "attention" ? "⚠" : r.health === "blocked" ? "✗" : "○";
      console.log(`  ${icon} ${r.name} | ${r.phase} | ${r.priority} | ${r.health}`);
    }
  },

  "roadmap:delete": async (db, args) => {
    requireArgs(1, "<id> [--cascade]", "roadmap", "delete", args);
    const id = parseInt(args[0]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const node = queryOne(db, "SELECT id, type, name FROM portfolio_nodes WHERE id = ?", [id]) as any;
    if (!node) { console.log(`Node #${id} not found`); return; }
    const children = queryOne(db, "SELECT COUNT(*) as c FROM portfolio_nodes WHERE parent_id = ?", [id]) as any;
    if (children.c > 0) { console.log(`Node #${id} has ${children.c} child(ren). Delete children first, or use --cascade.`); if (args.includes("--cascade")) run(db, "DELETE FROM portfolio_nodes WHERE parent_id = ?", [id]); else return; }
    run(db, "UPDATE projects SET node_id = NULL WHERE node_id = ?", [id]);
    run(db, "UPDATE milestones SET node_id = NULL WHERE node_id = ?", [id]);
    run(db, "DELETE FROM portfolio_nodes WHERE id = ?", [id]);
    console.log(`Deleted ${node.type} #${id}: ${node.name}`);
  },

  // ═══ node (alias for roadmap) ════════════════════════
  // node commands delegate to the same portfolio_nodes tables
  // with some slight variation in defaults and display

  "node:list": async (db, args) => {
    // delegates to same query as roadmap:list
    let filter = "";
    const params: any[] = [];
    let format = "table";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--type" && args[i + 1]) { filter += " AND n.type = ?"; params.push(args[++i]!); }
      else if (args[i] === "--parent" && args[i + 1]) { filter += " AND n.parent_id = ?"; params.push(parseInt(args[++i]!)); }
      else if (args[i] === "--roots") { filter += " AND n.parent_id IS NULL"; }
      else if (args[i] === "--format" && args[i + 1]) { format = args[++i]!; }
    }
    const rows = queryAll(db, `SELECT n.*, COUNT(pj.id) AS project_count FROM portfolio_nodes n LEFT JOIN projects pj ON n.id = pj.node_id WHERE 1=1 ${filter} GROUP BY n.id ORDER BY n.parent_id NULLS FIRST, n.sort_order, n.id`, params);
    if (!rows.length) { console.log("No nodes found"); return; }
    if (format === "json") { console.log(JSON.stringify(rows, null, 2)); return; }
    table(["ID", "Type", "Name", "Status", "Parent", "Projects"], rows.map((r: any) => [String(r.id), r.type, r.name, r.status, r.parent_id ? `#${r.parent_id}` : "—", String(r.project_count)]));
  },

  "node:get": async (db, args) => { await commands["roadmap:get"]!(db, args); },

  "node:tree": async (db, args) => {
    let fullTree = false, rootId: number | null = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--full") fullTree = true;
      else if (!rootId && args[i]) { rootId = parseInt(args[i]!); if (isNaN(rootId)) { console.log("Invalid ID"); return; } }
    }
    let rows: any[];
    if (rootId || fullTree) {
      rows = queryAll(db, `WITH RECURSIVE subtree AS (SELECT id, parent_id, type, name, status, sort_order, printf('%06d', id) AS sort_path, 0 AS depth FROM portfolio_nodes WHERE ${rootId ? "id = ?" : "parent_id IS NULL"} UNION ALL SELECT n.id, n.parent_id, n.type, n.name, n.status, n.sort_order, s.sort_path || '/' || printf('%06d', n.id), s.depth + 1 FROM portfolio_nodes n JOIN subtree s ON n.parent_id = s.id) SELECT s.*, p.name AS project_name FROM subtree s LEFT JOIN projects p ON s.id = p.node_id ORDER BY s.sort_path, p.name`, rootId ? [rootId] : []);
    } else {
      rows = queryAll(db, `SELECT n.*, p.name AS project_name FROM portfolio_nodes n LEFT JOIN projects p ON n.id = p.node_id WHERE n.parent_id IS NULL ORDER BY n.sort_order, n.id, p.name`);
    }
    if (!rows.length) { console.log("No nodes found"); return; }
    let lastId = -1;
    for (const r of rows) {
      const depth = r.depth ?? 0;
      if (r.id !== lastId) {
        if (lastId !== -1) console.log("");
        const indent = "  ".repeat(depth);
        const icon = r.type === "product" ? "▣" : r.type === "component" ? "▸" : r.type === "roadmap" ? "▣" : r.type === "initiative" ? "◆" : "▸";
        console.log(`${indent}${icon} #${r.id} [${r.type}] ${r.name} (${r.status})`);
        lastId = r.id;
      }
      if (r.project_name) console.log(`${"  ".repeat(depth + 1)}· ${r.project_name}`);
    }
  },

  "node:create": async (db, args) => {
    requireArgs(2, '<name> [--type <t>] [--parent <id>] [--description "..."]', "node", "create", args);
    const name = args[0]!;
    let type = "workstream", parentId: number | null = null, description: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--type" && args[i + 1]) type = args[++i]!;
      else if (args[i] === "--parent" && args[i + 1]) parentId = parseInt(args[++i]!);
      else if (args[i] === "--description" && args[i + 1]) description = args[++i]!;
    }
    run(db, "INSERT INTO portfolio_nodes (parent_id, type, name, description, status) VALUES (?, ?, ?, ?, 'active')", [parentId, type, name, description]);
    const created = queryOne(db, "SELECT id FROM portfolio_nodes ORDER BY id DESC LIMIT 1") as any;
    console.log(`Created ${type} #${created.id}: ${name}`);
  },

  "node:update": async (db, args) => { await commands["roadmap:update"]!(db, args); },

  "node:delete": async (db, args) => {
    requireArgs(1, "<id> [--cascade]", "node", "delete", args);
    const id = parseInt(args[0]!);
    if (isNaN(id)) { console.log("Invalid ID"); return; }
    const node = queryOne(db, "SELECT id, type, name FROM portfolio_nodes WHERE id = ?", [id]) as any;
    if (!node) { console.log(`Node #${id} not found`); return; }
    const children = queryOne(db, "SELECT COUNT(*) as c FROM portfolio_nodes WHERE parent_id = ?", [id]) as any;
    if (children.c > 0 && !args.includes("--cascade")) { console.log(`Node #${id} has ${children.c} children. Use --cascade to delete all.`); return; }
    if (args.includes("--cascade")) { run(db, "DELETE FROM portfolio_nodes WHERE parent_id = ?", [id]); }
    run(db, "UPDATE projects SET node_id = NULL WHERE node_id = ?", [id]);
    run(db, "UPDATE milestones SET node_id = NULL WHERE node_id = ?", [id]);
    run(db, "DELETE FROM portfolio_nodes WHERE id = ?", [id]);
    console.log(`Deleted ${node.type} #${id}: ${node.name}`);
  },

  // ═══ product ═════════════════════════════════════════
  "product:list": async (db, _args) => {
    const rows = queryAll(db, `WITH RECURSIVE subtree AS (SELECT id, id AS root_id FROM portfolio_nodes WHERE type = 'product' UNION ALL SELECT n.id, s.root_id FROM portfolio_nodes n JOIN subtree s ON n.parent_id = s.id) SELECT pn.*, COUNT(p.id) AS project_count FROM portfolio_nodes pn LEFT JOIN subtree s ON pn.id = s.root_id LEFT JOIN projects p ON p.node_id = s.id WHERE pn.type = 'product' GROUP BY pn.id ORDER BY pn.name`);
    if (!rows.length) { console.log("No products found"); return; }
    table(["ID", "Product", "Status", "Projects"], rows.map((r: any) => [String(r.id), r.name, r.status, String(r.project_count)]));
  },

  "product:tree": async (db, _args) => {
    const rows = queryAll(db, `WITH RECURSIVE tree AS (SELECT id, parent_id, type, name, status, printf('%06d', id) AS sort_path, 0 AS depth FROM portfolio_nodes WHERE type = 'product' UNION ALL SELECT n.id, n.parent_id, n.type, n.name, n.status, t.sort_path || '/' || printf('%06d', n.id), t.depth + 1 FROM portfolio_nodes n JOIN tree t ON n.parent_id = t.id) SELECT t.*, p.name AS project_name FROM tree t LEFT JOIN projects p ON t.id = p.node_id ORDER BY t.sort_path, p.name`);
    if (!rows.length) { console.log("No products found"); return; }
    let lastId = -1;
    for (const r of rows) {
      const depth = r.depth ?? 0;
      if (r.id !== lastId) {
        if (lastId !== -1 && r.depth === 0) console.log("");
        const indent = "  ".repeat(depth);
        const icon = r.type === "product" ? "▣" : r.type === "component" ? "▸" : "◆";
        console.log(`${indent}${icon} ${r.name} (${r.status})`);
        lastId = r.id;
      }
      if (r.project_name) console.log(`${"  ".repeat(depth + 1)}· ${r.project_name}`);
    }
    const unlinked = queryAll(db, "SELECT name FROM projects WHERE node_id IS NULL ORDER BY name") as any[];
    if (unlinked.length) {
      console.log(`\n▣ Unlinked Projects (${unlinked.length})`);
      for (const u of unlinked) console.log(`  · ${u.name}`);
    }
  },
};
