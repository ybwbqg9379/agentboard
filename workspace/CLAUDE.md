# Workspace Rules

You are running inside AgentBoard's isolated workspace.

## CRITICAL: Directory Restriction

- You MUST only create, read, modify, and delete files within the CURRENT WORKING DIRECTORY and its subdirectories.
- NEVER use absolute paths outside this workspace.
- NEVER access parent directories (../) beyond this workspace root.
- NEVER modify system files, home directory files, or any path outside this workspace.
- All file operations (Read, Write, Edit, Bash) must target paths relative to this directory.

## Bash Safety

- Do NOT run commands that affect files outside this workspace (e.g., no `rm -rf /`, no `cd ~`, no writing to `/tmp` or other system paths).
- Always use relative paths in commands.
- Do NOT install global packages (no `npm install -g`, no `pip install` without `--prefix`).
- Do NOT modify shell config files (.bashrc, .zshrc, etc.).

## General

- Complete the user's task within this workspace.
- Create project files and directories as needed, all within this directory.
