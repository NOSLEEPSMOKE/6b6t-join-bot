# 6b6t-join-bot

A 6b6t bot to simply join the server. It logs in a cracked (offline) account, gets
through the login server and the lobby, and tells you when it has really reached
the main server. Then it stays connected until you stop it.

One file, `6b6t-join.js`. You fill in a username and password at the top and run it.

## What it does

- **Connects** to 6b6t, trying `alt.6b6t.org` first and moving on to the other
  addresses if one is down or refuses the connection.
- **Logs in** with `/login` when the login server asks.
- **Walks through both portals**, first the login server's and then the lobby's.
  It only ever walks toward a portal it can actually see.
- **Waits on the backup server** if 6b6t queues you there. 6b6t moves you to main
  by itself when a spot is free.
- **Tells you when you're on main.** It prints `REACHED MAIN` once three things
  agree: the server's identity, its game mode and its player slots. 6b6t's own
  "You're now playing on worker-N" line follows a few seconds later.
- **Stays connected** until you press Ctrl+C, and tells you if 6b6t moves you off
  main and back.
- **Stops and shows you the link for VPN / anti-bot verification.** Open the link
  in a browser on the same computer or network, complete it, then run the bot again.
- **Handles the rest of what 6b6t does at join.**
  - It retries on its own for "logging in too fast", a name that is still online
    from a previous session, DDoS-shield blocks and dropped connections.
  - It stops with a plain explanation for things only you can fix: a wrong
    password, an account that isn't registered, a name owned by a paid Minecraft
    account, too many accounts on your IP, or a verification cooldown.
- **Never prints your password**, never crouches or sprints, and doesn't use a
  proxy or change how you connect.

## Requirements

[Node.js](https://nodejs.org) 22 or newer.

## Use

1. Put `6b6t-join.js` in an empty folder.
2. Open it and fill in `USERNAME` and `PASSWORD` at the top.
3. In that folder, run:

   ```
   node 6b6t-join.js
   ```

   The first run installs the libraries it needs, which takes about a minute.

4. Press Ctrl+C to disconnect.

Your filled-in copy contains your password, so don't share it or commit it. You
can also leave the file blank and set `JOIN_USERNAME` and `JOIN_PASSWORD` as
environment variables instead.

A typical run looks like this:

```
Now on: login server
Sent /login (prompted).
Logged in.
Walking into the login portal (12 blocks)...
Now on: lobby
Walking into the lobby portal (13 blocks)...
Now on: MAIN server   (brand Fox (FasterVelocity), survival, 1000 slots, overworld)
 REACHED MAIN - YourName is on 6b6t's main server.
[6b6t] ✦ You're now playing on worker-0, hosted on node-15 in us-east.
```

## Settings

These are at the top of the file.

| Setting | Default | What it does |
|---|---|---|
| `USERNAME`, `PASSWORD` | empty | Your cracked 6b6t login. |
| `SERVERS` | `alt.6b6t.org`, `alt4`, `alt5`, `alt2`, `alt3` | Addresses to try, in order. |
| `STAY_ON_MAIN` | `true` | `false` disconnects as soon as main is reached. |
| `REGISTER_IF_NEEDED` | `false` | `true` registers a brand-new account with `PASSWORD`. |
| `SHOW_CHAT_ON_MAIN` | `false` | `true` keeps printing chat after reaching main. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | You stopped it, or it reached main with `STAY_ON_MAIN = false` |
| 1 | Unexpected error |
| 2 | VPN / anti-bot verification needed. Verify, then run it again |
| 3 | Verification cooldown. Wait the time it says |
| 4 | The name belongs to a paid Minecraft account |
| 5 | Too many accounts connected from your IP (6b6t allows 3) |
| 6 | Wrong password, or the login was never confirmed |
| 7 | The account isn't registered on 6b6t |
| 8 | 6b6t rejected the Minecraft version, so the bot needs updating |
| 9 | 6b6t held the connection without letting the bot in, twice (usually a cooldown) |
| 10 | Gave up after repeated failures |
| 11 | Setup problem (Node version, missing login, libraries) |

## Versions

The bot runs the same library versions as the 6b6t map-art bots: Minecraft
1.21.11, mineflayer 4.38.0, minecraft-protocol 1.68.0, prismarine-chat 1.13.0,
minecraft-data 3.115.0 and prismarine-registry 1.12.0. It checks these on start
and installs them if they're missing.

prismarine-chat 1.13.0 has a bug on 1.21.11 that silently freezes a connection
partway through joining. The bot applies the same one-line fix the map-art bots
use, and a self-test proves the fix is active.
