#!/usr/bin/env bash
# dual-brain shell integration
# Add to .bashrc with one command:
#   dual-brain shell-hook >> ~/.bashrc
# Or source directly:
#   source /path/to/shell-hook.sh

# Quick alias
alias db='dual-brain'

# Show session manager on new interactive terminal.
# Skipped when:
#   - not a TTY (non-interactive shell, CI, pipes)
#   - DUAL_BRAIN_LOADED already set (prevents double-launch in nested shells)
#   - DUAL_BRAIN_SKIP=1 (user opt-out)
#   - DATA_TOOLS_LOADED or CLAUDE_MENU_LOADED is set (data-tools is managing the shell)
if [ -t 1 ] \
  && [ -z "$DUAL_BRAIN_LOADED" ] \
  && [ -z "$DUAL_BRAIN_SKIP" ] \
  && [ -z "$DATA_TOOLS_LOADED" ] \
  && [ -z "$CLAUDE_MENU_LOADED" ]; then
  export DUAL_BRAIN_LOADED=1
  if command -v dual-brain &>/dev/null; then
    dual-brain
  fi
fi
