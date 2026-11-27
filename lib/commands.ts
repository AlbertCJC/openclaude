export type Command = { name: string; args?: string; desc: string; skill?: boolean };

export const COMMANDS: Command[] = [
  { name: 'plan', desc: 'Plan mode: read-only, then propose a plan' },
  { name: 'auto', desc: 'Auto-edit mode: edits without asking' },
  { name: 'ask', desc: 'Ask before every edit' },
  { name: 'model', args: '<provider/model>', desc: 'Switch model' },
  { name: 'effort', args: 'low|medium|high', desc: 'Set reasoning effort' },
  { name: 'clear', desc: 'Start a new conversation' },
  { name: 'resume', desc: 'Open a previous conversation' },
  { name: 'rename', args: '<title>', desc: 'Rename this conversation' },
  { name: 'compact', desc: 'Summarize the conversation to save context' },
  { name: 'cost', desc: 'Tokens used in this conversation' },
  { name: 'init', desc: 'Create a CLAUDE.md for this workspace' },
  { name: 'review', desc: 'Review uncommitted changes' },
  { name: 'mcp', desc: 'MCP server status' },
  { name: 'tasks', desc: 'Background jobs' },
  { name: 'schedule', desc: 'Scheduled prompts' },
  { name: 'permissions', args: '[add|remove <bash prefix>]', desc: 'Bash commands that skip approval' },
  { name: 'trust', desc: "Run this workspace's .claude/settings.json hooks" },
  { name: 'help', desc: 'List commands' },
];

// Commands that just send a prompt to the model.
export const PROMPTS: Record<string, string> = {
  init: 'Analyze this workspace (stack, commands, architecture, conventions) and write a concise CLAUDE.md at the workspace root. If one exists, improve it instead of replacing it.',
  review: 'Review the uncommitted changes (run `git diff` and `git diff --staged`). Report bugs, security issues and simplifications, most severe first, with path:line.',
  compact: 'Summarize this whole conversation for continuation: the goal, decisions made, files changed, current state and next steps. Be complete but concise. Output only the summary.',
};

export function parseCommand(text: string, all: Command[] = COMMANDS) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  const cmd = m && all.find(c => c.name === m[1]);
  return cmd ? { name: cmd.name, arg: m[2].trim(), skill: !!cmd.skill } : null;
}
