#!/usr/bin/env bash
# Stdio entrypoint for MCP clients (Claude Code, Hermes).
#
# WHY THIS WRAPPER EXISTS
# -----------------------
# MigrationManager defaults to a RELATIVE migrations path (see
# src/services/migrations.ts — `migrationsPath: string = './migrations'`), and
# mcp-server.ts constructs it without one. Whatever directory the MCP client
# happens to launch from therefore either gets a stray `migrations/` directory
# created in it, or logs `EACCES: permission denied, mkdir './migrations'` when
# that directory is not writable.
#
# Neither client offers a way to set the child process's working directory:
# `claude mcp add` has no --cwd flag, and Hermes' tools/mcp_tool.py passes no
# cwd to the stdio transport. Fixing it in one place here keeps both client
# configs identical and free of inline shell quoting.
#
# `exec` matters: the client manages this process's lifetime over stdio, so bun
# must replace the shell rather than run as its child, or termination signals
# land on the wrapper and leave bun orphaned.
set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Resolved from PATH, never a hardcoded /nix/store path — those get
# garbage-collected and fail later with a misleading error.
exec bun "$REPO/dist/mcp-server.js" "$@"
