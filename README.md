# My PI.DEV Setup

Personal PI.DEV configuration with custom extensions and workflows.

## Extensions

### Plan Mode

**Location:** `./agent/extensions/plan-mode/`

Plan Mode is a read-only exploration extension that blocks file modifications while enabling safe research and planning. When the agent completes a plan, it automatically presents a three-option approval menu (Approve/Feedback/Reject) for seamless transition to implementation mode. The extension features a clean UI with status indicators only shown when active, session persistence, and comprehensive tool safety checks.

**Usage:**
```bash
/plan        # Toggle plan mode on/off
/plan-status # Check current status
/todos       # View plan progress
```
