CREATE TABLE agent_layers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id),
    layer_num       INTEGER NOT NULL CHECK(layer_num >= 0),
    name            TEXT NOT NULL,
    description     TEXT,
    topology        TEXT DEFAULT 'hierarchical' CHECK(topology IN ('hierarchical','mesh','star','ring','adaptive','hierarchical-mesh')),
    consensus       TEXT DEFAULT 'L0-authority' CHECK(consensus IN ('L0-authority','raft','byzantine','gossip','crdt','quorum')),
    checkpoint_interval INTEGER DEFAULT 5,
    max_tracks      INTEGER DEFAULT 3,
    min_model_tier  TEXT DEFAULT 'sonnet',
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, layer_num)
  );
CREATE TABLE agent_tracks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    layer_id        INTEGER NOT NULL REFERENCES agent_layers(id),
    track_letter    TEXT NOT NULL,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('architect','designer','engineer','reviewer','researcher','implementer')),
    raci            TEXT NOT NULL DEFAULT 'R',
    assigned_agent  TEXT,
    assigned_model  TEXT DEFAULT 'sonnet',
    assigned_harness TEXT DEFAULT 'claude-code',
    isolation_mode  TEXT DEFAULT 'file-domain' CHECK(isolation_mode IN ('file-domain','worktree','none')),
    file_domain     TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(layer_id, track_letter)
  );
CREATE TABLE "agent_workers" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    subagent_id INTEGER REFERENCES subagents(id),
    session_id INTEGER REFERENCES sessions(id),
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT CHECK(status IN ('idle','dispatched','running','waiting','completed','failed','cancelled')) DEFAULT 'idle',
    task_description TEXT,
    milestone_id INTEGER REFERENCES milestones(id),
    parent_worker_id INTEGER REFERENCES agent_workers(id),
    started_at TEXT,
    completed_at TEXT,
    result_summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    feature_id INTEGER REFERENCES features(id),
    atomic_task_id INTEGER REFERENCES atomic_tasks(id),
    token_usage INTEGER,
    cost_estimate REAL,
    retry_count INTEGER DEFAULT 0,
    attempt INTEGER DEFAULT 1,
    harness_name TEXT
  , swarm_task_id INTEGER REFERENCES swarm_tasks(id), layer_num INTEGER, track_letter TEXT, routing_code INTEGER, handoff_version TEXT, harness TEXT DEFAULT 'claude-code');
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  severity TEXT CHECK(severity IN ('info','warning','critical')),
  message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
, doctor_action_id INTEGER REFERENCES doctor_actions(id), eval_run_id INTEGER REFERENCES eval_runs(id));
CREATE TABLE atomic_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id INTEGER REFERENCES milestones(id),
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending','in-progress','done','blocked')) DEFAULT 'pending',
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
, node_id INTEGER REFERENCES portfolio_nodes(id), feature_id INTEGER REFERENCES features(id), session_id INTEGER REFERENCES sessions(id), methods TEXT, evidence TEXT, closed_at TEXT);
CREATE TABLE automation_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  value_type TEXT DEFAULT 'string',
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, key)
);
CREATE TABLE background_workers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    name          TEXT NOT NULL,
    agent_type    TEXT NOT NULL,
    model         TEXT DEFAULT 'haiku',
    description   TEXT,
    schedule_interval INTEGER NOT NULL,
    priority      TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
    is_enabled    INTEGER DEFAULT 1,
    last_run_at   TEXT,
    next_run_at   TEXT,
    run_count     INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE build_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER REFERENCES projects(id),
    node_id       INTEGER REFERENCES portfolio_nodes(id),
    feature_id    INTEGER REFERENCES features(id),
    harness_name  TEXT,
    status        TEXT NOT NULL CHECK(status IN ('running','success','failed','cancelled')),
    command       TEXT NOT NULL,
    output        TEXT,
    duration_ms   INTEGER,
    artifact_path TEXT,
    commit_sha    TEXT,
    branch        TEXT,
    started_at    TEXT DEFAULT (datetime('now')),
    completed_at  TEXT
  );
CREATE TABLE ci_pipeline_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id   INTEGER REFERENCES pipelines(id),
    project_id    INTEGER REFERENCES projects(id),
    node_id       INTEGER REFERENCES portfolio_nodes(id),
    trigger       TEXT CHECK(trigger IN ('push','pr','manual','scheduled')),
    status        TEXT NOT NULL CHECK(status IN ('running','success','failed','cancelled')),
    commit_sha    TEXT,
    branch        TEXT,
    duration_ms   INTEGER,
    started_at    TEXT DEFAULT (datetime('now')),
    completed_at  TEXT
  );
CREATE TABLE compliance_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    standard_id INTEGER NOT NULL REFERENCES standards(id),
    passed      INTEGER NOT NULL,
    detail      TEXT,
    scanned_at  TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE decision_impacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER REFERENCES decisions(id),
  affected_table TEXT NOT NULL,
  affected_id INTEGER NOT NULL,
  impact_type TEXT CHECK(impact_type IN ('blocks','invalidates','requires-change')),
  noted_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  question TEXT NOT NULL,
  decision TEXT,
  rationale TEXT,
  status TEXT CHECK(status IN ('open','decided','superseded')) DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_project_id INTEGER REFERENCES projects(id),
  to_project_id INTEGER REFERENCES projects(id),
  description TEXT,
  status TEXT CHECK(status IN ('active','resolved')) DEFAULT 'active'
);
CREATE TABLE deploy_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER REFERENCES projects(id),
    node_id       INTEGER REFERENCES portfolio_nodes(id),
    build_id      INTEGER REFERENCES build_runs(id),
    environment   TEXT NOT NULL CHECK(environment IN ('dev','staging','production')),
    status        TEXT NOT NULL CHECK(status IN ('running','success','failed','rolled_back')),
    provider      TEXT,
    url           TEXT,
    output        TEXT,
    duration_ms   INTEGER,
    started_at    TEXT DEFAULT (datetime('now')),
    completed_at  TEXT
  );
CREATE TABLE doctor_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type   TEXT NOT NULL,
    color         TEXT NOT NULL CHECK(color IN ('green','yellow','red')),
    target        TEXT NOT NULL,
    diagnosis     TEXT,
    confidence    REAL DEFAULT 1.0,
    blast_radius  TEXT,
    reversible    INTEGER DEFAULT 1,
    auto_execute  INTEGER DEFAULT 0,
    needs_approval INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE eval_defs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_id       TEXT NOT NULL UNIQUE,
    category      TEXT NOT NULL CHECK(category IN (
      'agent_quality','session_health','hook_reliability','data_integrity',
      'standards_compliance','platform_responsiveness','cross_project_coherence',
      'skill_effectiveness','custom'
    )),
    target        TEXT NOT NULL,
    metric        TEXT NOT NULL,
    query_sql     TEXT,
    threshold_healthy   TEXT,
    threshold_attention TEXT,
    threshold_critical  TEXT,
    frequency     TEXT DEFAULT 'weekly' CHECK(frequency IN ('on_session','daily','weekly','monthly','manual')),
    auto_fix      INTEGER DEFAULT 0,
    alert_on      TEXT DEFAULT 'critical' CHECK(alert_on IN ('any','attention','critical','never')),
    enabled       INTEGER DEFAULT 1,
    description   TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE eval_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_def_id   INTEGER NOT NULL REFERENCES eval_defs(id),
    session_id    INTEGER REFERENCES sessions(id),
    status        TEXT NOT NULL CHECK(status IN ('pass','fail','attention','error')),
    score         REAL,
    result_json   TEXT,
    run_at        TEXT DEFAULT (datetime('now')),
    duration_ms   INTEGER,
    triggered_by  TEXT
  );
CREATE TABLE features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  status TEXT CHECK(status IN ('planned','in-progress','done','blocked')) DEFAULT 'planned',
  description TEXT,
  epic_milestone_id INTEGER REFERENCES milestones(id),
  priority TEXT CHECK(priority IN ('critical','high','medium','low')),
  created_at TEXT DEFAULT (datetime('now'))
, node_id INTEGER REFERENCES portfolio_nodes(id), component TEXT, spec_ref TEXT);
CREATE TABLE harness_adapters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    instruction_file TEXT,
    config_file     TEXT,
    agent_spawn     TEXT NOT NULL,
    skill_invoke    TEXT,
    command_run     TEXT NOT NULL,
    adapter_file    TEXT,
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','planned','deprecated')),
    created_at      TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE harness_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      harness       TEXT NOT NULL CHECK(harness IN (
                      'claude-code','antigravity','gemini-cli',
                      'opencode','cursor','windsurf','custom'
                    )),
      session_id    TEXT NOT NULL UNIQUE,
      project_id    INTEGER REFERENCES projects(id),
      started_at    TEXT DEFAULT (datetime('now')),
      ended_at      TEXT,
      summary       TEXT,
      files_read    TEXT,
      files_edited  TEXT,
      model_used    TEXT,
      tokens_used   INTEGER
    );
CREATE TABLE heal_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id     INTEGER REFERENCES doctor_actions(id),
    session_id    INTEGER REFERENCES sessions(id),
    status        TEXT NOT NULL CHECK(status IN ('success','failed','rolled_back','pending_approval','rejected')),
    snapshot_json TEXT,
    error_message TEXT,
    executed_at   TEXT DEFAULT (datetime('now')),
    duration_ms   INTEGER,
    rolled_back_at TEXT
  , eval_run_id INTEGER REFERENCES eval_runs(id));
CREATE TABLE hook_handlers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hook_id INTEGER REFERENCES hooks(id),
  handler_order INTEGER DEFAULT 0,
  command TEXT NOT NULL,
  timeout_ms INTEGER DEFAULT 5000,
  parallel INTEGER DEFAULT 0,
  matcher TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE hooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  event_name TEXT NOT NULL,
  matcher TEXT,
  handler TEXT,
  description TEXT,
  status TEXT CHECK(status IN ('active','inactive','error')) DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')), config_source TEXT, handler_count INTEGER DEFAULT 0,
  UNIQUE(project_id, event_name)
);
CREATE TABLE integration_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  from_tool TEXT NOT NULL,
  to_tool TEXT NOT NULL,
  via TEXT,
  description TEXT,
  status TEXT CHECK(status IN ('active','planned','broken')) DEFAULT 'active',
  UNIQUE(project_id, from_tool, to_tool)
);
CREATE TABLE mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  config_path TEXT,
  tool_count INTEGER DEFAULT 0,
  transport TEXT DEFAULT 'stdio',
  status TEXT CHECK(status IN ('connected','disconnected','error','pending')) DEFAULT 'pending',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);
CREATE TABLE mcp_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mcp_server_id INTEGER REFERENCES mcp_servers(id),
  tool_name TEXT NOT NULL,
  description TEXT,
  UNIQUE(mcp_server_id, tool_name)
);
CREATE TABLE methodologies (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL UNIQUE,
    description       TEXT,
    detection_signals TEXT NOT NULL,
    artifact_mappings TEXT NOT NULL,
    phase_rules       TEXT,
    priority          INTEGER DEFAULT 0,
    enabled           INTEGER DEFAULT 1,
    created_at        TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  due TEXT,
  status TEXT CHECK(status IN ('pending','in-progress','completed','blocked')) DEFAULT 'pending',
  acceptance_criteria TEXT,
  created_at TEXT DEFAULT (datetime('now')), node_id INTEGER REFERENCES portfolio_nodes(id),
  UNIQUE(project_id, name)
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('project','milestone','decision','feature','task','roadblock','standalone')),
  target_id INTEGER,
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE oracle_insights (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL CHECK(category IN (
      'observation','research','synthesis','proposal'
    )),
    title         TEXT NOT NULL,
    description   TEXT,
    evidence_json TEXT,
    source        TEXT,
    confidence    REAL DEFAULT 0.7,
    impact_score  REAL,
    feasibility   REAL,
    status        TEXT DEFAULT 'new' CHECK(status IN (
      'new','analyzing','proposed','accepted','rejected','implemented'
    )),
    related_insight_ids TEXT,
    session_id    INTEGER REFERENCES sessions(id),
    created_at    TEXT DEFAULT (datetime('now')),
    reviewed_at   TEXT,
    reviewed_by   TEXT
  , eval_run_id INTEGER REFERENCES eval_runs(id));
CREATE TABLE patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  source_project_ids TEXT,
  category TEXT CHECK(category IN ('tech-choice','pitfall','workflow','architecture')),
  confidence REAL DEFAULT 0.5,
  created_at TEXT DEFAULT (datetime('now'))
, node_id INTEGER REFERENCES portfolio_nodes(id), feature_id INTEGER REFERENCES features(id), observed_in_session_id INTEGER REFERENCES sessions(id));
CREATE TABLE pipeline_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER REFERENCES pipelines(id),
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  tool TEXT,
  command TEXT,
  description TEXT,
  expected_output TEXT,
  timeout_ms INTEGER DEFAULT 30000,
  UNIQUE(pipeline_id, step_order)
);
CREATE TABLE pipelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK(category IN ('build','test','deploy','re','quality','custom')),
  trigger TEXT CHECK(trigger IN ('manual','file-watch','git-hook','scheduled','mcp')),
  status TEXT CHECK(status IN ('active','inactive','draft')) DEFAULT 'draft',
  config_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);
CREATE TABLE plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  install_method TEXT,
  install_command TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);
CREATE TABLE "portfolio_nodes" (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id     INTEGER REFERENCES "portfolio_nodes"(id),
    type          TEXT NOT NULL CHECK(type IN (
                    'product','component','project','module',
                    'workstream','epic','feature','initiative',
                    'roadmap'  -- legacy, mapped to initiative
                  )),
    name          TEXT NOT NULL,
    description   TEXT,
    status        TEXT DEFAULT 'active' CHECK(status IN (
                    'active','planned','completed','archived','stale'
                  )),
    sort_order    INTEGER DEFAULT 0,
    target_date   TEXT,
    goals         TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  status TEXT CHECK(status IN ('active','paused','completed','archived')) DEFAULT 'active',
  phase TEXT CHECK(phase IN ('discover','define','design','build','ship','maintain')),
  priority TEXT CHECK(priority IN ('critical','high','medium','low')),
  repo_path TEXT,
  tech_stack TEXT,
  health TEXT CHECK(health IN ('healthy','attention','blocked','stale')),
  last_session TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
, node_id INTEGER REFERENCES portfolio_nodes(id));
CREATE TABLE protocol_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  provider TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending','captured','generated','verified')) DEFAULT 'pending',
  endpoints_count INTEGER DEFAULT 0,
  models_count INTEGER DEFAULT 0,
  captured_at TEXT,
  source_file TEXT,
  generated_file TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, provider)
);
CREATE TABLE roadblocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  description TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('low','medium','high','critical')),
  time_sink_hours REAL DEFAULT 0,
  milestone_id INTEGER REFERENCES milestones(id),
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
, feature_id INTEGER REFERENCES features(id), blocking_worker_id INTEGER REFERENCES agent_workers(id));
CREATE TABLE schema_versions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    version       TEXT NOT NULL UNIQUE,
    description   TEXT,
    filename      TEXT,
    applied_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE session_capsules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  capsule_path TEXT NOT NULL,
  summary TEXT,
  decisions_count INTEGER DEFAULT 0,
  files_changed TEXT,
  next_steps TEXT,
  state_snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  summary TEXT,
  git_commits TEXT,
  checkpoint_id TEXT
, harness TEXT DEFAULT 'claude-code', model_used TEXT);
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  path TEXT,
  description TEXT,
  triggers TEXT,
  auto_trigger INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('active','inactive','draft')) DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')), disable_model_invocation INTEGER DEFAULT 0, user_invocable INTEGER DEFAULT 1, context TEXT CHECK(context IN ('default','fork')) DEFAULT 'default', plugin_id INTEGER REFERENCES plugins(id),
  UNIQUE(project_id, name)
);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE standards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL,
    rule_key      TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    severity      TEXT NOT NULL,
    check_type    TEXT NOT NULL,
    target        TEXT NOT NULL,
    expected      TEXT,
    project_types TEXT DEFAULT '*',
    auto_fix      INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(category, rule_key)
  );
CREATE TABLE subagent_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subagent_id INTEGER REFERENCES subagents(id),
  tool_name TEXT NOT NULL,
  tool_category TEXT,
  UNIQUE(subagent_id, tool_name)
);
CREATE TABLE subagents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  tier TEXT CHECK(tier IN ('low','medium','high')) NOT NULL,
  model TEXT CHECK(model IN ('haiku','sonnet','opus')) NOT NULL,
  base_agent TEXT,
  delegation_category TEXT,
  temperature REAL,
  thinking_budget TEXT,
  description TEXT,
  best_for TEXT,
  trackable INTEGER DEFAULT 0,
  force_register INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);
CREATE TABLE success_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  criterion TEXT NOT NULL,
  met INTEGER DEFAULT 0,
  evidence TEXT,
  created_at TEXT DEFAULT (datetime('now'))
, milestone_id INTEGER REFERENCES milestones(id), feature_id INTEGER REFERENCES features(id));
CREATE TABLE swarm_audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    task_id       INTEGER NOT NULL REFERENCES swarm_tasks(id),
    worker_id     INTEGER REFERENCES agent_workers(id),
    action        TEXT NOT NULL CHECK(action IN ('checkout','checkin','release','approve','reject','escalate','resolve','status_update','artifact_share')),
    layer_num     INTEGER,
    track_letter  TEXT,
    details       TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE swarm_escalations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    task_id       INTEGER NOT NULL REFERENCES swarm_tasks(id),
    from_layer    INTEGER NOT NULL,
    to_layer      INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    severity      TEXT DEFAULT 'P2' CHECK(severity IN ('P0','P1','P2')),
    status        TEXT DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
    resolved_by   INTEGER REFERENCES agent_workers(id),
    resolution    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    resolved_at   TEXT
  );
CREATE TABLE swarm_handoffs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    manifest      TEXT NOT NULL,
    format_version TEXT DEFAULT '1.0',
    layers_count  INTEGER,
    tasks_count   INTEGER,
    routing_codes_used TEXT,
    export_path   TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE swarm_tasks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL REFERENCES projects(id),
    feature_id        INTEGER REFERENCES features(id),
    milestone_id      INTEGER REFERENCES milestones(id),
    layer_num         INTEGER NOT NULL,
    track_letter      TEXT,
    routing_code      INTEGER DEFAULT 3 CHECK(routing_code BETWEEN 0 AND 99),
    name              TEXT NOT NULL,
    description       TEXT,
    acceptance_criteria TEXT,
    dependencies      TEXT,
    status            TEXT DEFAULT 'pending' CHECK(status IN ('pending','claimed','in_progress','review','completed','rejected','escalated')),
    claimed_by        INTEGER REFERENCES agent_workers(id),
    claimed_at        TEXT,
    started_at        TEXT,
    submitted_at      TEXT,
    completed_at      TEXT,
    evidence          TEXT,
    review_comment    TEXT,
    escalated_to      INTEGER,
    escalation_reason TEXT,
    raci_responsible  TEXT,
    raci_accountable  TEXT,
    raci_consulted    TEXT,
    raci_informed     TEXT,
    estimated_tokens  INTEGER,
    actual_tokens     INTEGER,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE tool_setup_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tooling_id INTEGER REFERENCES tooling(id),
  step_order INTEGER NOT NULL,
  command TEXT NOT NULL,
  description TEXT,
  platform TEXT DEFAULT 'all',
  UNIQUE(tooling_id, step_order)
);
CREATE TABLE tooling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  tool_name TEXT NOT NULL,
  category TEXT,
  config_path TEXT,
  status TEXT DEFAULT 'active'
, description TEXT, pricing TEXT DEFAULT 'free', setup_effort TEXT CHECK(setup_effort IN ('low','medium','high')) DEFAULT 'low', priority TEXT CHECK(priority IN ('critical','high','medium','low','none')) DEFAULT 'medium', docs_url TEXT, installed_version TEXT);
CREATE TABLE verification_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  session_id INTEGER REFERENCES sessions(id),
  check_type TEXT NOT NULL,
  status TEXT CHECK(status IN ('pass','fail','skipped')) NOT NULL,
  evidence TEXT,
  output TEXT,
  run_at TEXT DEFAULT (datetime('now'))
, node_id INTEGER REFERENCES portfolio_nodes(id), feature_id INTEGER REFERENCES features(id), ci_run_id INTEGER REFERENCES ci_pipeline_runs(id));
