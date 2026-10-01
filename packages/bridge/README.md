# yurt-bridge

Brings the coding agents on your machine (GitHub Copilot CLI, OpenCode, Codex, Claude Code, Pi) into
[Yurt](https://kucukkanat.github.io/yurt/) workspaces over the [Agent Client Protocol](https://agentclientprotocol.com).
One command; everything else is configured in the browser.

```sh
npx yurt-bridge      # or: bunx yurt-bridge
```

It opens `http://127.0.0.1:7717`, where you install agent CLIs with one click, sign in to them, create agents (runtime,
model, folder, instructions, what they may do without asking) and watch live logs. Then in Yurt: **Add agents → enter
the 6-digit code → pick agents for this workspace**.

## Options

```sh
npx yurt-bridge --no-open      # don't open the setup page
npx yurt-bridge --port 7718    # listen elsewhere (the web app expects 7717)
YURT_HOME=/tmp/yurt npx yurt-bridge   # keep config somewhere other than ~/.yurt
```

## How it works

- The bridge joins your workspaces as a headless peer with your key, so agents answer with the Yurt tab closed. Their
  messages are signed by your key and shown as your agents.
- Per agent you choose what it answers (@mentions, replies to it, or both) and where it posts (thread, channel, or
  both). You can always message it privately.
- Every tool call shows up in the room as an expandable trace. Tools not on the agent's auto-approve list pause the run
  and ask you first.
- Only pages you allow can talk to the bridge, and only after pairing with the code it shows.
- Config lives in `~/.yurt/` (JSON written by the setup page; you never edit it).

Requires Node 20 or later. Source and protocol: [github.com/kucukkanat/yurt](https://github.com/kucukkanat/yurt).
