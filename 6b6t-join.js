'use strict'
/*
 * 6b6t join bot - cracked (offline) accounts
 * ===========================================
 * Connects to 6b6t, logs in, gets through the login server and the lobby, and
 * tells you when it has really reached the MAIN server.
 *
 * HOW TO USE
 *   1. Install Node.js 22 or newer from https://nodejs.org
 *   2. Put this file in an empty folder.
 *   3. Type your username and password between the quotes below, then save.
 *   4. Open a terminal in that folder and run:    node 6b6t-join.js
 *      The first run downloads the exact libraries it needs (about a minute).
 *   5. Press Ctrl+C to disconnect.
 *
 * VPN / ANTI-BOT VERIFICATION
 *   If 6b6t wants to verify your connection, the bot prints the kick message and
 *   the verify link, then stops. Open the link in a browser on the SAME computer
 *   or network the bot runs on, complete it, then start the bot again.
 */

// ============================== FILL THESE IN ==============================
const USERNAME = ''            // your cracked 6b6t username
const PASSWORD = ''            // the password you registered on 6b6t with /register
// ===========================================================================

// Optional settings. Tried in this order; the next one is used if one fails.
const SERVERS = ['alt.6b6t.org', 'alt4.6b6t.org', 'alt5.6b6t.org', 'alt2.6b6t.org', 'alt3.6b6t.org']
const STAY_ON_MAIN = true        // false = disconnect as soon as main is reached
const REGISTER_IF_NEEDED = false // true = if the account is new, register it with PASSWORD
const SHOW_CHAT_ON_MAIN = false  // true = keep printing chat after reaching main

/*
 * Exit codes: 0 stopped by you (or reached main with STAY_ON_MAIN false),
 * 1 unexpected error, 2 VPN/anti-bot verification needed, 3 verification cooldown,
 * 4 name owned by a premium account, 5 too many accounts on this IP, 6 wrong
 * password / login never confirmed, 7 account not registered, 8 server rejected
 * the Minecraft version, 9 held without being let in (probably a cooldown),
 * 10 gave up after repeated failures, 11 setup problem.
 */

// --------------------------------------------------------------------------
// Everything below this line is the bot. You should not need to change it.
// --------------------------------------------------------------------------

if (typeof require !== 'function' || typeof module === 'undefined') {
  console.error('This file must run as CommonJS. Rename it to 6b6t-join.cjs and run: node 6b6t-join.cjs')
  process.exit(11)
}

const EXIT = { OK: 0, CRASH: 1, VERIFY: 2, COOLDOWN: 3, PREMIUM: 4, LIMIT: 5, WRONG_PASSWORD: 6, NOT_REGISTERED: 7, VERSION: 8, SILENT: 9, GAVE_UP: 10, SETUP: 11 }

const nodeMajor = Number(String(process.versions.node).split('.')[0])
if (!(nodeMajor >= 22)) {
  console.error(`Node.js 22 or newer is required (this is ${process.version}). Get it from https://nodejs.org`)
  process.exit(EXIT.SETUP)
}

// JOIN_USERNAME / JOIN_PASSWORD / JOIN_SERVERS let you keep the login out of the
// file. JOIN_TIME_SCALE only shortens retry waits, for testing.
const NAME = String(process.env.JOIN_USERNAME || USERNAME).trim()
const PASS = String(process.env.JOIN_PASSWORD || PASSWORD)
const TIME_SCALE = Math.max(0.01, Math.min(1, Number(process.env.JOIN_TIME_SCALE) || 1))
const scaled = (ms) => Math.max(1, Math.round(ms * TIME_SCALE))

if (!NAME || !PASS) {
  console.error('Open this file and fill in USERNAME and PASSWORD at the top, then run it again.')
  process.exit(EXIT.SETUP)
}
if (!/^[A-Za-z0-9_]{1,16}$/.test(NAME)) {
  console.error(`USERNAME "${NAME}" is not a valid Minecraft name (up to 16 letters, digits or _).`)
  process.exit(EXIT.SETUP)
}
if (/\s/.test(PASS)) {
  console.error('PASSWORD contains a space. 6b6t passwords cannot contain spaces - check it.')
  process.exit(EXIT.SETUP)
}

function parseServer (entry) {
  const s = String(entry || '').trim()
  if (!s) return null
  const m = /^(.+?)(?::(\d{1,5}))?$/.exec(s)
  return { host: m[1], port: m[2] ? Number(m[2]) : 25565 }
}
const SERVER_LIST = (process.env.JOIN_SERVERS ? process.env.JOIN_SERVERS.split(',') : SERVERS).map(parseServer).filter(Boolean)
if (!SERVER_LIST.length) {
  console.error('SERVERS is empty.')
  process.exit(EXIT.SETUP)
}

// ---------------------------------------------------------------- output --

const COLOR = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 }
const useColor = !!(process.stdout && process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (color, s) => (useColor && COLOR[color] ? `\x1b[${COLOR[color]}m${s}\x1b[0m` : s)
const clock = () => new Date().toTimeString().slice(0, 8)
// The password is never printed, even if something echoes it back.
const redact = (s) => (PASS.length >= 3 ? String(s).split(PASS).join('********') : String(s))
function log (msg, color) {
  try { console.log(paint(color, `[${clock()}] ${redact(msg)}`)) } catch (e) {}
}
function print (lines, color) {
  for (const l of lines) { try { console.log(paint(color, redact(l))) } catch (e) {} }
}
function banner (lines, color) {
  const bar = '='.repeat(66)
  print(['', bar, ...lines.map((l) => (l ? ' ' + l : '')), bar, ''], color)
}
const secs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.max(0, Math.round(ms / 1000))}s`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------ setup --
//
// Same library versions as the 6b6t map-art bots (checked in their running
// container): Minecraft 1.21.11, mineflayer 4.38.0, minecraft-protocol 1.68.0.

const VERSION = '1.21.11'
const PINNED = {
  mineflayer: '4.38.0',
  'minecraft-protocol': '1.68.0',
  'prismarine-chat': '1.13.0',
  'minecraft-data': '3.115.0',
  'prismarine-registry': '1.12.0',
  protodef: '1.19.0',
  'prismarine-nbt': '2.8.0',
  'readable-stream': '4.7.0'
}

const Module = require('module')
const path = require('path')
const fs = require('fs')

/*
 * prismarine-chat 1.13.0 throws on some 1.21.11 chat (uuidFromIntArray feeds a
 * BigInt to writeInt32BE). The throw happens inside a packet handler and wedges
 * the connection: logged in, no chunks, no spawn, no error, no kick - it just
 * looks like the server went silent. The map-art bots patch the file with sed
 * in their Dockerfile; this applies the identical one-line change in memory,
 * before mineflayer loads, and a self-test below proves it took.
 */
const PC_BAD = 'buf.writeInt32BE(num,'
const PC_GOOD = 'buf.writeInt32BE(Number(num),'
const originalCompile = Module.prototype._compile
Module.prototype._compile = function (content, filename, ...rest) {
  if (typeof content === 'string' && /[\\/]prismarine-chat[\\/]index\.js$/.test(String(filename)) && content.includes(PC_BAD)) {
    content = content.split(PC_BAD).join(PC_GOOD)
  }
  return originalCompile.call(this, content, filename, ...rest)
}

function findPackageDir (name, fromDir) {
  for (const dir of Module._nodeModulePaths(fromDir)) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}
function versionOf (pkgDir) {
  try { return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version } catch (e) { return null }
}
// Checks each library where mineflayer and minecraft-protocol will actually load it from.
function versionProblems () {
  const problems = new Set()
  const need = (name, fromDir) => {
    const dir = fromDir ? findPackageDir(name, fromDir) : null
    const got = dir ? versionOf(dir) : null
    if (got !== PINNED[name]) problems.add(`${name} ${got || 'missing'} (need ${PINNED[name]})`)
    return dir
  }
  const mf = need('mineflayer', __dirname)
  if (!mf) return [...problems]
  const nmp = need('minecraft-protocol', mf)
  need('prismarine-chat', mf)
  need('minecraft-data', mf)
  need('prismarine-registry', mf)
  if (nmp) {
    need('prismarine-chat', nmp)
    need('prismarine-nbt', nmp)
    const pd = need('protodef', nmp)
    if (pd) need('readable-stream', pd)
  }
  return [...problems]
}
function installPinned () {
  const pkgFile = path.join(__dirname, 'package.json')
  const pinned = Object.fromEntries(Object.entries(PINNED).sort(([a], [b]) => (a < b ? -1 : 1)))
  let pkg = null
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) } catch (e) {}
  if (!pkg) {
    pkg = {
      name: '6b6t-join-bot',
      private: true,
      type: 'commonjs',
      description: 'Libraries for 6b6t-join.js, pinned to the versions the 6b6t map-art bots run.',
      dependencies: pinned,
      overrides: pinned
    }
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
  }
  // A package.json that already pins everything (the repo's own, or the one
  // just written) is installed as it is, lockfile included, and left untouched.
  const declared = Object.entries(PINNED).every(([n, v]) => pkg.dependencies && pkg.dependencies[n] === v)
  const args = declared
    ? ['install', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund', '--save-exact', ...Object.entries(pinned).map(([n, v]) => `${n}@${v}`)]
  log('Installing the exact library versions the map-art bots use (first run only, about a minute)...')
  const r = require('child_process').spawnSync('npm', args, { cwd: __dirname, stdio: 'inherit', shell: true })
  return !r.error && r.status === 0
}

let problems = versionProblems()
if (problems.length) {
  log('Missing or wrong libraries: ' + problems.join(', '))
  if (!installPinned() || (problems = versionProblems()).length) {
    print([
      '',
      'Could not install the libraries automatically' + (problems.length ? ' (' + problems.join(', ') + ')' : '') + '.',
      'In this folder, run:',
      '  npm install --save-exact ' + Object.entries(PINNED).map(([n, v]) => `${n}@${v}`).join(' '),
      'then start the bot again.'
    ], 'red')
    process.exit(EXIT.SETUP)
  }
}

const MF_DIR = findPackageDir('mineflayer', __dirname)
const NMP_DIR = findPackageDir('minecraft-protocol', MF_DIR)
const mineflayer = require(MF_DIR)

// Prove the prismarine-chat fix is live in the copy mineflayer AND the copy
// minecraft-protocol loaded. Without it the bot can never finish joining.
for (const from of [MF_DIR, NMP_DIR]) {
  let out = ''
  try {
    out = require(findPackageDir('prismarine-chat', from)).processNbtMessage({
      type: 'compound', name: '', value: { id: { type: 'intArray', value: [1n, 2n, 3n, 4n] } }
    })
  } catch (e) { out = 'threw ' + e.message }
  if (out !== '{"id":"00000001000000020000000300000004"}') {
    console.error('SETUP PROBLEM: the prismarine-chat fix is not active (' + out + '). Run this file with plain `node 6b6t-join.js`.')
    process.exit(EXIT.SETUP)
  }
}

// ---------------------------------------------------- protocol protection --

// The only packets a 1.21.11 client may send in the configuration state
// (minecraft-data 3.115.0, configuration.toServer 0x00-0x09).
const CONFIGURATION_SERVERBOUND = new Set([
  'settings', 'cookie_response', 'custom_payload', 'finish_configuration', 'keep_alive',
  'pong', 'resource_pack_receive', 'select_known_packs', 'custom_click_action', 'accept_code_of_conduct'
])
// Held back between a server switch finishing and the new server's login.
const MOVEMENT = new Set(['position', 'position_look', 'look', 'flying', 'player_input', 'entity_action', 'vehicle_move', 'teleport_confirm'])
const VANILLA_DIMENSIONS = {
  'minecraft:overworld': [-64, 384],
  'minecraft:overworld_caves': [-64, 384],
  'minecraft:the_nether': [0, 256],
  'minecraft:the_end': [0, 256]
}

/*
 * Every server switch on 6b6t (login server -> lobby -> backup -> main) puts the
 * connection back into the CONFIGURATION state. mineflayer does not know that:
 * its physics timer keeps writing movement packets, and minecraft-protocol
 * encodes a play packet in that state as a bare 0x00, which Velocity answers with
 * "An internal error occurred in your connection." (51 such kicks in 3 hours on
 * the kit bots before they got this guard). Installed in the same tick as
 * createBot, before anything can write.
 */
function guardClient (c, conn) {
  c.setMaxListeners(100) // minecraft-protocol adds a code_of_conduct listener every switch

  // 1) A throw in any packet handler must not unwind into the packet parser
  //    (that silently wedges the socket), nor stop the handlers after it -
  //    minecraft-protocol's own configuration replies are registered after ours.
  const emit = c.emit
  c.emit = function (event, ...args) {
    if (event === 'packet') conn.lastPacketAt = Date.now()
    const listeners = this.rawListeners(event)
    if (listeners.length === 0) return emit.call(this, event, ...args)
    for (const listener of listeners) {
      try {
        listener.apply(this, args)
      } catch (e) {
        if (conn.listenerThrows++ < 10) log(`(protocol) a "${String(event)}" handler failed and was contained: ${(e && e.message) || e}`, 'gray')
      }
    }
    return true
  }

  // 2) Nothing but configuration packets in the configuration state. Keyed on
  //    minecraft-protocol's own state, which only flips after it has written
  //    configuration_acknowledged, so that ack is never caught here.
  const write = c.write.bind(c)
  c.write = function (name, params) {
    const n = String(name)
    if ((c.state === 'configuration' && !CONFIGURATION_SERVERBOUND.has(n)) ||
        (conn.awaitingLogin && c.state === 'play' && MOVEMENT.has(n))) {
      if (!conn.dropped.has(n)) {
        conn.dropped.add(n)
        log(`(protocol) held back "${n}" during a server switch`, 'gray')
      }
      return false
    }
    return write(name, params)
  }

  // 3) Replies neither library sends. A vanilla client answers a cookie request
  //    with an empty cookie, and accepts a resource pack by its id. Never use
  //    mineflayer's denyResourcePack() on 1.21.11: its second write has no id and
  //    breaks the connection.
  c.on('cookie_request', (p) => {
    try { write('cookie_response', { key: p.cookie }) } catch (e) {}
  })
  c.on('add_resource_pack', (p) => {
    try {
      write('resource_pack_receive', { uuid: p.uuid, result: 3 }) // accepted
      write('resource_pack_receive', { uuid: p.uuid, result: 0 }) // loaded
    } catch (e) {}
  })
}

// A registry entry sent without data made mineflayer throw during login (seen 8
// times on the map-art bots). Keep every entry in place - ids are positions -
// and give the empty ones a placeholder.
function guardRegistry (bot) {
  const reg = bot.registry
  if (!reg || typeof reg.loadDimensionCodec !== 'function') return
  const load = reg.loadDimensionCodec.bind(reg)
  reg.loadDimensionCodec = (codec) => {
    try {
      if (codec && Array.isArray(codec.entries) && codec.entries.some((e) => !e || e.value == null)) {
        const id = String(codec.id || '')
        codec = {
          ...codec,
          entries: codec.entries.map((e) => {
            if (e && e.value != null) return e
            const dim = id.endsWith('dimension_type') && VANILLA_DIMENSIONS[e && e.key]
            const value = dim ? { min_y: { type: 'int', value: dim[0] }, height: { type: 'int', value: dim[1] } } : {}
            return { key: e && e.key, value: { type: 'compound', name: '', value } }
          })
        }
      }
      return load(codec)
    } catch (e) {
      log(`(protocol) could not load registry ${codec && codec.id}: ${e && e.message}`, 'gray')
    }
  }
}

// ----------------------------------------------------------------- kicks --

const NBT_TAGS = new Set(['compound', 'list', 'string', 'int', 'byte', 'short', 'long', 'float', 'double', 'intArray', 'byteArray', 'longArray', 'end'])
function simplifyNbt (n) {
  if (n == null || typeof n !== 'object') return n
  if (Array.isArray(n)) return n.map(simplifyNbt)
  if (typeof n.type === 'string' && NBT_TAGS.has(n.type) && 'value' in n) {
    if (n.type === 'compound') {
      const o = {}
      for (const [k, v] of Object.entries(n.value || {})) o[k] = simplifyNbt(v)
      return o
    }
    if (n.type === 'list') {
      const inner = n.value
      const items = Array.isArray(inner) ? inner : (inner && inner.value)
      return Array.isArray(items) ? items.map(simplifyNbt) : []
    }
    return simplifyNbt(n.value)
  }
  const o = {}
  for (const [k, v] of Object.entries(n)) o[k] = simplifyNbt(v)
  return o
}
function flatten (c) {
  if (c == null) return ''
  if (typeof c !== 'object') return String(c)
  if (Array.isArray(c)) return c.map(flatten).join('')
  let s = ''
  if (c.text != null) s += String(c.text)
  else if (c.translate != null) s += String(c.translate)
  if (Array.isArray(c.extra)) s += c.extra.map(flatten).join('')
  if (Array.isArray(c.with)) s += ' ' + c.with.map(flatten).join(' ')
  return s
}
// Colour codes, and 6b6t's custom-font icons (private-use characters), which a
// console can only show as boxes.
const cleanText = (s) => String(s == null ? '' : s).replace(/§[0-9a-fk-orx]/gi, '').replace(/[\uE000-\uF8FF\uFFFD]|[\u{F0000}-\u{10FFFF}]/gu, '')

// A kick at login is a JSON string; during a server switch or in game it is an
// NBT tree. Returns readable text plus the raw form (links are searched in both).
function kickText (reason) {
  let raw = ''
  try {
    raw = typeof reason === 'string' ? reason : JSON.stringify(reason, (k, v) => (typeof v === 'bigint' ? String(v) : v))
  } catch (e) { raw = String(reason) }
  let comp = reason
  if (typeof reason === 'string') { try { comp = JSON.parse(reason) } catch (e) { comp = reason } }
  let text = ''
  try { text = flatten(simplifyNbt(comp)) } catch (e) {}
  text = cleanText(text).trim()
  return { text: text || raw, raw }
}

const VERIFY_LINK = /https?:\/\/(?:verify\.6b6t\.org\/[A-Za-z0-9]{4,12}|verify\.enderdash\.com\/c\/[A-Za-z0-9]{4,12})/i
const ANY_VERIFY_LINK = /https?:\/\/[^\s"'\\<>]*verif[^\s"'\\<>]*/i

// First match wins. Every string here is one the map-art bots have logged,
// except wrong-password, whose exact wording has never been captured.
function classifyKick ({ text, raw }) {
  const h = text + '\n' + raw
  const link = (VERIFY_LINK.exec(text) || VERIFY_LINK.exec(raw) || ANY_VERIFY_LINK.exec(text) || [])[0] || null
  if (link || /anti bot protection|prove you'?re a human|flagged for further verification|vpn\/proxy\/unregistered/i.test(h)) {
    return { kind: 'vpn-verification', link: link && link.replace(/[.,;)]+$/, '') }
  }
  if (/verification link expired/i.test(h)) {
    const w = /wait\s+(\d+)\s+(minute|second)s?/i.exec(h)
    return { kind: 'verification-expired', wait: w ? `${w[1]} ${w[2]}${w[1] === '1' ? '' : 's'}` : null }
  }
  if (/own the mojang account|choose another username/i.test(h)) return { kind: 'premium-name' }
  if (/connected account limit/i.test(h)) return { kind: 'account-limit' }
  if (/wrong password|incorrect password|invalid password/i.test(h)) return { kind: 'wrong-password' }
  if (/unsupported minecraft version|outdated (client|server)/i.test(h)) return { kind: 'version-mismatch' }
  if (/unable to connect to [\w.-]+:|internal server connection error/i.test(h)) return { kind: 'backend-unreachable' }
  if (/ddos protection|connection blocked/i.test(h)) {
    const w = /wait\s+(\d+)\s*s\b/i.exec(h)
    return { kind: 'ddos-blocked', waitMs: w ? Number(w[1]) * 1000 : 30000 }
  }
  if (/logging in too fast|too fast/i.test(h)) return { kind: 'too-fast' }
  if (/already online|already connected|logged in from another location/i.test(h)) return { kind: 'already-online' }
  if (/internal error occurred|encountered a problem/i.test(h)) return { kind: 'connection-error' }
  return { kind: 'other' }
}

// --------------------------------------------------------------- the bot --

const G = {
  serverIndex: 0,
  failsOnServer: 0,
  failures: 0, // connections in a row that ended without reaching main
  silentHolds: 0,
  journeyStart: 0, // when the current attempt to reach main began
  connSeq: 0,
  conn: null,
  reconnectTimer: null,
  stopping: false
}
const MAX_FAILURES = 8
const PORTAL_SEARCH_MS = 45000
const WALK_MS = 30000
const WALK_TRIES = 3

function newConn (server) {
  return {
    id: ++G.connSeq,
    server,
    bot: null,
    startedAt: Date.now(),
    lastPacketAt: Date.now(),
    timers: new Set(),
    dropped: new Set(),
    listenerThrows: 0,
    ended: false,
    endIntent: null,
    lastKick: null,
    lastError: null,
    playLogins: 0, // play 'login' packets; the first one is always the login server
    brandThisPass: null, // server brand from the current configuration pass only
    awaitingLogin: false,
    kind: 'connecting',
    authed: false,
    loginSends: 0,
    registerSent: false,
    walkToken: 0,
    walkTries: {},
    groundTimer: null,
    posSinceLogin: false,
    onMain: false,
    mainSince: 0,
    mainAnnounced: false,
    workerLine: null,
    workerLineLogin: -1,
    backupSince: 0,
    lastActionBar: ''
  }
}
function safe (fn) {
  try { fn() } catch (e) { log('(bot) ' + ((e && e.stack) || e), 'gray') }
}
function later (conn, ms, fn) {
  const t = setTimeout(() => { conn.timers.delete(t); if (!conn.ended && !G.stopping) safe(fn) }, ms)
  conn.timers.add(t)
  return t
}
function every (conn, ms, fn) {
  const t = setInterval(() => { if (conn.ended || G.stopping) clearInterval(t); else safe(fn) }, ms)
  conn.timers.add(t)
  return t
}

function connect () {
  G.reconnectTimer = null
  if (G.stopping) return
  const server = SERVER_LIST[G.serverIndex % SERVER_LIST.length]
  const conn = newConn(server)
  G.conn = conn
  if (!G.journeyStart) G.journeyStart = conn.startedAt
  log(`Connecting to ${server.host}${server.port === 25565 ? '' : ':' + server.port} as ${NAME}...`, 'cyan')
  let bot
  try {
    bot = mineflayer.createBot({
      host: server.host,
      port: server.port,
      username: NAME,
      auth: 'offline',
      version: VERSION,
      physicsEnabled: false, // switched on once the floor has loaded
      checkTimeoutInterval: 60000,
      logErrors: false,
      hideErrors: true
    })
  } catch (e) {
    conn.lastError = e
    log('Could not start the connection: ' + ((e && e.message) || e), 'red')
    conn.ended = true
    return afterEnd(conn, 'create-failed')
  }
  conn.bot = bot
  guardClient(bot._client, conn)
  guardRegistry(bot)
  bot.on('error', (e) => {
    conn.lastError = e
    const code = e && (e.code || e.message)
    if (!conn.lastKick) log(`Connection problem: ${code}`, 'gray')
  })
  wire(conn)
  watchdogs(conn)
}

function wire (conn) {
  const bot = conn.bot
  const c = bot._client

  // Listeners on the protocol client added now run BEFORE minecraft-protocol's
  // own, so on start_configuration the state is still 'play' and clearing the
  // controls is a legal write.
  c.on('start_configuration', () => {
    conn.brandThisPass = null
    stopWalk(conn)
    stopGroundHold(conn)
    try { bot.physicsEnabled = false } catch (e) {}
    log(conn.onMain ? 'Server switch while on main...' : 'Server switch...', 'gray')
  })
  c.on('finish_configuration', () => { conn.awaitingLogin = true })
  c.on('minecraft:brand', (brand) => { conn.brandThisPass = String(brand == null ? '' : brand).trim() })

  // bot 'login' fires for EVERY server (login server, lobby, backup, main), after
  // mineflayer has read that server's login packet. 'spawn' fires once per
  // connection and never after a switch, so nothing waits for it.
  bot.on('login', () => safe(() => onPlayLogin(conn)))
  bot.on('forcedMove', () => { conn.posSinceLogin = true })
  bot.on('respawn', () => safe(() => { if (conn.kind === 'main') startGroundHold(conn, 'main') }))
  bot.once('spawn', () => later(conn, 2500, () => {
    if (conn.kind === 'auth' && !conn.authed && conn.loginSends === 0 && !conn.registerSent) sendLogin(conn, 'no prompt seen yet')
  }))
  bot.on('death', () => { if (conn.onMain) log('The bot died on main; respawning.', 'yellow') })
  bot.on('messagestr', (msg, position) => safe(() => onServerLine(conn, msg, position)))
  bot.on('kicked', (reason, loggedIn) => safe(() => onKicked(conn, reason, loggedIn)))
  bot.on('end', (reason) => safe(() => onEnd(conn, reason)))
}

function watchdogs (conn) {
  // Never let in at all. Long enough that a late kick from the proxy (seen
  // about 48s after connecting) is still read and shown.
  later(conn, scaled(75000), () => {
    if (conn.playLogins === 0) {
      log('6b6t has not let the bot in after 75s.', 'yellow')
      endConn(conn, 'login-timeout')
    }
  })
  // Connected but receiving nothing: 6b6t sends something at least every ~15s.
  every(conn, 2000, () => {
    const idle = Date.now() - conn.lastPacketAt
    if (idle > 30000) {
      log(`Nothing received from 6b6t for ${secs(idle)}; the connection is dead.`, 'yellow')
      endConn(conn, 'silent')
    }
  })
  every(conn, scaled(15 * 60000), () => {
    if (conn.mainAnnounced) log(`Still on main (connected ${secs(Date.now() - conn.startedAt)}).`, 'gray')
  })
}

// Ends the connection on purpose. The socket is destroyed after 5s if the
// server does not close it, but 'kicked' stays wired until then so a late kick
// reason is still shown.
function endConn (conn, intent) {
  if (conn.ended) return
  conn.endIntent = intent
  try { conn.bot.end(intent) } catch (e) {}
  setTimeout(() => {
    if (!conn.ended) { try { conn.bot._client.socket.destroy() } catch (e) {} }
  }, 5000)
}

// ------------------------------------------------------- where are we? --

function describe (kind) {
  return {
    auth: 'login server',
    lobby: 'lobby',
    backup: 'backup server (queue)',
    main: 'MAIN server',
    'main-unconfirmed': 'probably main',
    unknown: 'an unrecognised server'
  }[kind] || kind
}

/*
 * Decided at each play login, from that server's login packet and the brand it
 * sent during this switch. Measured identities: main = "Fox (FasterVelocity)",
 * survival, 1000 slots; lobby = "Paper (FasterVelocity)", adventure, 10000;
 * backup = "PicoLimbo (FasterVelocity)", adventure, 1. Player count and the
 * dimension do not tell them apart. The first play login of a cracked connection
 * is always the login server, whose own fields were never recorded, so main is
 * only possible from the second login on.
 */
function classifyServer (conn) {
  const g = conn.bot.game || {}
  const mode = String(g.gameMode == null ? '' : g.gameMode).toLowerCase()
  const slots = Number(g.maxPlayers)
  const brand = conn.brandThisPass || ''
  if (conn.playLogins === 1) return 'auth'
  if (/limbo/i.test(brand) || slots === 1) return 'backup'
  if (mode === 'survival' && slots === 1000) return 'main'
  if (/^paper\b/i.test(brand) || (mode === 'adventure' && slots === 10000)) return 'lobby'
  if (/^fox\b/i.test(brand)) return 'main-unconfirmed'
  return 'unknown'
}

function onPlayLogin (conn) {
  const bot = conn.bot
  conn.playLogins++
  conn.awaitingLogin = false
  conn.walkTries = {}
  const kind = classifyServer(conn)
  const wasOnMain = conn.onMain
  conn.kind = kind
  const g = bot.game || {}
  log(`Now on: ${describe(kind)}   (brand ${conn.brandThisPass || 'not sent'}, ${g.gameMode}, ${g.maxPlayers} slots, ${g.dimension})`, 'cyan')
  startGroundHold(conn, kind)

  if (kind === 'main' || kind === 'main-unconfirmed') {
    if (wasOnMain && conn.mainAnnounced) {
      log('Still on main (moved to another main worker).', 'gray')
      conn.mainSince = Date.now()
      return
    }
    return onMainLogin(conn)
  }
  if (wasOnMain) {
    conn.onMain = false
    if (conn.mainAnnounced) {
      log(`Left main -> ${describe(kind)}. Waiting to get back...`, 'yellow')
      G.journeyStart = Date.now()
    }
    conn.mainAnnounced = false
  }
  if (kind === 'auth') log('Waiting for the login prompt...')
  else if (kind === 'lobby') startWalk(conn, 'lobby portal')
  else if (kind === 'backup') onBackup(conn)
  else if (String(g.gameMode) === 'adventure') startWalk(conn, 'portal') // a changed lobby, most likely
  else log('Not sure which server this is; waiting to be moved.', 'yellow')
}

function onBackup (conn) {
  const since = conn.backupSince = Date.now()
  log('Waiting on the backup server. 6b6t moves you to main by itself when a spot is free, usually within a minute or two.')
  later(conn, scaled(30 * 60000), () => {
    if (conn.kind === 'backup' && conn.backupSince === since) {
      log('Still on the backup server after 30 minutes; reconnecting.', 'yellow')
      endConn(conn, 'backup-timeout')
    }
  })
}

function onMainLogin (conn) {
  conn.onMain = true
  conn.mainAnnounced = false
  const since = conn.mainSince = Date.now()
  const loginNo = conn.playLogins
  const current = () => conn.onMain && conn.mainSince === since && conn.playLogins === loginNo
  // A short settle so a main that immediately hands us back to the backup
  // server is not reported. The server's own "now playing on worker-N" line
  // lands about 3s after arrival and also confirms.
  later(conn, 3000, () => { if (current()) tryAnnounceMain(conn) })
  later(conn, 12000, () => { if (current() && !conn.mainAnnounced) announceMain(conn, 'fields') })
}

function tryAnnounceMain (conn) {
  if (!conn.onMain || conn.mainAnnounced) return
  if (Date.now() - conn.mainSince < 2900) return
  if (conn.kind === 'main' && /^fox\b/i.test(conn.brandThisPass || '')) return announceMain(conn, 'brand')
  if (conn.workerLineLogin === conn.playLogins) return announceMain(conn, 'line')
}

function announceMain (conn, how) {
  if (conn.mainAnnounced) return
  conn.mainAnnounced = true
  G.failures = 0
  G.failsOnServer = 0
  G.silentHolds = 0
  const g = conn.bot.game || {}
  const evidence = []
  if (conn.brandThisPass) evidence.push(`server brand ${conn.brandThisPass}`)
  evidence.push(`${g.gameMode} mode`, `${g.maxPlayers} player slots`)
  if (conn.workerLineLogin === conn.playLogins) evidence.push('"now playing on" message')
  const lines = [`REACHED MAIN - ${NAME} is on 6b6t's main server.`]
  if (conn.workerLine && conn.workerLineLogin === conn.playLogins) lines.push(conn.workerLine)
  lines.push(`Confirmed by: ${evidence.join(', ')}.`)
  if (how === 'fields') lines.push('(6b6t did not send its usual confirmation, so this rests on the server identity above.)')
  lines.push(`Took ${secs(Date.now() - (G.journeyStart || conn.startedAt))}. ${STAY_ON_MAIN ? 'Staying connected; press Ctrl+C to disconnect.' : ''}`)
  banner(lines, 'green')
  G.journeyStart = 0
  if (!STAY_ON_MAIN) stop(EXIT.OK, ['Disconnecting now (STAY_ON_MAIN is false).'])
}

// Physics stays off after every server switch until the floor under the bot has
// loaded. mineflayer builds an all-air column when light data arrives before the
// chunk, and with physics on the bot falls straight through the platform.
function groundReady (bot) {
  const p = bot.entity && bot.entity.position
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false
  const below = bot.blockAt(p.offset(0, -1, 0))
  return !!below && below.boundingBox === 'block'
}
function startGroundHold (conn, kind) {
  const bot = conn.bot
  stopGroundHold(conn)
  conn.posSinceLogin = false
  try { bot.physicsEnabled = false } catch (e) {}
  if (kind === 'backup') return // no floor there; the bot just waits
  const since = Date.now()
  const capped = kind === 'auth' || kind === 'lobby' || kind === 'main'
  conn.groundTimer = every(conn, 100, () => {
    const ready = conn.posSinceLogin && groundReady(bot)
    if (ready || (capped && Date.now() - since > 10000)) {
      stopGroundHold(conn)
      bot.physicsEnabled = true
    }
  })
}
function stopGroundHold (conn) {
  if (conn.groundTimer) { clearInterval(conn.groundTimer); conn.timers.delete(conn.groundTimer); conn.groundTimer = null }
}

// -------------------------------------------------------------- logging in --

function onServerLine (conn, msg, position) {
  const text = cleanText(msg).replace(/\s+$/, '')
  if (!text.trim()) return
  if (position === 'game_info') {
    if (text === conn.lastActionBar) return
    conn.lastActionBar = text
  }
  // Before main everything the server says is worth seeing (there are no other
  // players on the login server). After main, only if asked for - except 6b6t's
  // own "now playing on worker-N" line, which is its proof you are on main.
  const isWorkerLine = position !== 'chat' && /now playing on worker-\d+, hosted on node-\d+/i.test(text)
  // 6b6t sends player chat as server messages, so chat goes quiet the moment
  // main is detected, not only once it is announced.
  const show = isWorkerLine || ((conn.onMain || conn.mainAnnounced) ? SHOW_CHAT_ON_MAIN : (position !== 'chat' || conn.kind === 'auth'))
  if (show) for (const line of text.split('\n')) if (line.trim()) log(`[6b6t] ${line.trim()}`)

  if (conn.kind === 'auth' && !conn.authed) {
    if (/please register to 6b6t|\/register <password>/i.test(text)) {
      if (!REGISTER_IF_NEEDED) {
        return stop(EXIT.NOT_REGISTERED, [
          'This account is not registered on 6b6t yet.',
          'Set REGISTER_IF_NEEDED = true at the top of the file to register it with PASSWORD,',
          'or register it once yourself with a normal Minecraft client, then run the bot again.'
        ])
      }
      if (!conn.registerSent && conn.bot._client.state === 'play' && !conn.awaitingLogin) {
        conn.registerSent = true
        try { conn.bot.chat('/register ' + PASS + ' ' + PASS) } catch (e) {}
        log('Account not registered yet; sent /register with PASSWORD.')
        later(conn, 20000, () => {
          if (!conn.authed && conn.kind === 'auth') {
            log('Registration was not confirmed after 20s; trying the portal anyway...', 'yellow')
            startWalk(conn, 'login portal')
          }
        })
      }
    }
    if (/wrong password|incorrect password|invalid password/i.test(text)) {
      return stop(EXIT.WRONG_PASSWORD, ['6b6t says the password is wrong. Fix PASSWORD at the top of the file, then run the bot again.'])
    }
    if (/please login with the command|\/login <password>/i.test(text)) {
      if (conn.loginSends === 0) sendLogin(conn, 'prompted')
    }
    if (/you are now logged in|successfully logged in|logged in successfully|successfully registered|registered successfully/i.test(text)) onAuthed(conn)
  }

  // "✦ You're now playing on worker-3, hosted on node-2 in us-east." - sent by
  // the server (never player chat) about 3s after arriving on main, only there.
  if (position !== 'chat' && /now playing on worker-\d+, hosted on node-\d+/i.test(text)) {
    conn.workerLine = text.replace(/^[^A-Za-z]+/, '').trim()
    conn.workerLineLogin = conn.playLogins
    if (!conn.onMain && conn.playLogins >= 2) {
      log('6b6t says this is main.', 'cyan')
      stopWalk(conn)
      conn.kind = 'main'
      onMainLogin(conn) // its settle timer announces
    }
    tryAnnounceMain(conn)
  }
}

// One /login per connection, like the map-art bots, and a single resend if the
// server never answers (a command written mid-switch is lost).
function sendLogin (conn, why) {
  if (conn.authed || conn.loginSends >= 2 || conn.kind !== 'auth') return
  const bot = conn.bot
  if (bot._client.state !== 'play' || conn.awaitingLogin || typeof bot.chat !== 'function') {
    later(conn, 500, () => sendLogin(conn, why))
    return
  }
  conn.loginSends++
  const n = conn.loginSends
  try { bot.chat('/login ' + PASS) } catch (e) { log('Could not send /login: ' + e.message, 'red'); return }
  log(`Sent /login (${why}).`)
  later(conn, 8000, () => {
    if (!conn.authed && conn.kind === 'auth' && conn.loginSends === n && n < 2) sendLogin(conn, 'no answer yet, sending again')
  })
  if (n === 1) {
    later(conn, 20000, () => {
      if (!conn.authed && conn.kind === 'auth') {
        log('The login was not confirmed after 20s; trying the portal anyway...', 'yellow')
        startWalk(conn, 'login portal')
      }
    })
  }
}

function onAuthed (conn) {
  if (conn.authed) return
  conn.authed = true
  log('Logged in.', 'green')
  later(conn, 1500, () => { if (conn.kind === 'auth') startWalk(conn, 'login portal') })
}

// ---------------------------------------------------------- portal walks --
//
// Both portals are a short straight line from where the server puts you, so this
// walks with plain controls (no pathfinder): face the portal, hold forward, jump
// only when it is a step up. Never sneaks, never sprints. It never walks toward a
// guessed position - if no portal block can be seen, it does not move. Success is
// the server switch itself; a switch cancels the walk.

function stopWalk (conn) {
  conn.walkToken++
  try { conn.bot.clearControlStates() } catch (e) {}
}

function startWalk (conn, label) {
  if (conn.ended || G.stopping) return
  const token = ++conn.walkToken
  const attempt = conn.walkTries[label] = (conn.walkTries[label] || 0) + 1
  walk(conn, label, token, attempt).catch((e) => log(`(walk) ${(e && e.message) || e}`, 'gray'))
}

async function walk (conn, label, token, attempt) {
  const bot = conn.bot
  const loginNo = conn.playLogins
  const alive = () => token === conn.walkToken && !conn.ended && !G.stopping &&
    bot._client.state === 'play' && !conn.awaitingLogin && conn.playLogins === loginNo && !!bot.entity
  const portal = bot.registry.blocksByName.nether_portal
  if (!portal) return log('(walk) this Minecraft version has no nether portal block?', 'red')

  // Chunks keep arriving for a few seconds after a switch, so keep looking.
  let block = null
  const searchUntil = Date.now() + PORTAL_SEARCH_MS
  while (alive() && Date.now() < searchUntil) {
    if (conn.posSinceLogin && groundReady(bot)) {
      block = bot.findBlock({ matching: portal.id, maxDistance: 32 })
      if (block) break
    }
    await sleep(250)
  }
  if (!alive()) return
  if (!block) return walkFailed(conn, label, attempt, 'no portal in sight')

  bot.physicsEnabled = true
  const goal = block.position.offset(0.5, 0, 0.5)
  const start = bot.entity.position.clone()
  log(`Walking into the ${label} (${Math.round(start.distanceTo(goal))} blocks)...`)
  const walkUntil = Date.now() + WALK_MS
  while (alive() && Date.now() < walkUntil) {
    const p = bot.entity.position
    if (p.y < start.y - 3) {
      try { bot.clearControlStates() } catch (e) {}
      return walkFailed(conn, label, attempt, 'fell off the platform')
    }
    const d = Math.hypot(goal.x - p.x, goal.z - p.z)
    bot.lookAt(goal.offset(0, p.y + 1.6 - goal.y, 0), true).catch(() => {})
    // Standing next to a portal does nothing; keep steering into the block.
    bot.setControlState('forward', d > 0.25)
    bot.setControlState('jump', d > 2 && goal.y - p.y > 0.6)
    await sleep(50)
  }
  if (token !== conn.walkToken || conn.ended || conn.playLogins !== loginNo) return // switched: it worked
  try { bot.clearControlStates() } catch (e) {}
  if (conn.awaitingLogin || bot._client.state !== 'play') return
  walkFailed(conn, label, attempt, 'no server switch after 30s')
}

function walkFailed (conn, label, attempt, why) {
  if (conn.ended || G.stopping) return
  if (conn.kind === 'auth' && !conn.authed) {
    return stop(EXIT.WRONG_PASSWORD, [
      'The login was never confirmed, and the login server would not let the bot through.',
      'Check USERNAME and PASSWORD at the top of the file. (Accounts with 2FA cannot use this bot.)'
    ])
  }
  const loginNo = conn.playLogins
  if (attempt < WALK_TRIES) {
    log(`${label}: ${why}. Trying again in 5s...`, 'yellow')
    later(conn, 5000, () => { if (conn.playLogins === loginNo) startWalk(conn, label) })
    return
  }
  log(`${label}: ${why}, ${attempt} times. Reconnecting...`, 'yellow')
  endConn(conn, 'stuck')
}

// ------------------------------------------------------- kicks and endings --

function onKicked (conn, reason, loggedIn) {
  const k = kickText(reason)
  conn.lastKick = { ...classifyKick(k), text: k.text, raw: k.raw, loggedIn }
  log('Kicked by the server:', 'red')
  print(k.text.split('\n').map((l) => '    ' + l), 'red')
  if (conn.lastKick.kind === 'other' && k.raw !== k.text) print(['    (raw: ' + k.raw.slice(0, 500) + ')'], 'gray')
}

function onEnd (conn, reason) {
  if (conn.ended) return
  conn.ended = true
  for (const t of conn.timers) { clearTimeout(t); clearInterval(t) }
  conn.timers.clear()
  if (G.conn !== conn) return
  afterEnd(conn, reason)
}

// The kick decides, if there was one; it always arrives just before 'end'.
function afterEnd (conn, reason) {
  if (G.stopping) return
  const k = conn.lastKick
  const kick = k ? k.kind : null
  if (kick === 'vpn-verification') return stop(EXIT.VERIFY, verifyLines(k))
  if (kick === 'verification-expired') {
    return stop(EXIT.COOLDOWN, [
      `The verification link expired and 6b6t says to wait ${k.wait || 'a while'}.`,
      `Wait ${k.wait || 'that long'}, then restart the bot and verify the new link it shows.`,
      '(Restarting sooner makes 6b6t lengthen the wait, up to 120 minutes.)'
    ])
  }
  if (kick === 'premium-name') {
    return stop(EXIT.PREMIUM, ['This username belongs to a paid Minecraft account, so it cannot join as a cracked account.', 'Change USERNAME at the top of the file.'])
  }
  if (kick === 'account-limit') {
    return stop(EXIT.LIMIT, ['6b6t allows 3 accounts per IP, and your IP already has that many connected.', 'Disconnect one of them, then restart the bot.'])
  }
  if (kick === 'wrong-password') {
    return stop(EXIT.WRONG_PASSWORD, ['6b6t says the password is wrong. Fix PASSWORD at the top of the file, then run the bot again.'])
  }
  if (kick === 'version-mismatch') {
    return stop(EXIT.VERSION, [`6b6t rejected Minecraft ${VERSION}. The server has probably updated, and this bot needs updating too.`])
  }
  if (kick === 'too-fast') return retry(conn, backoff(10000), 'Logging in too fast for 6b6t', { rotate: false })
  if (kick === 'already-online') return retry(conn, 60000, 'This name is still online from an earlier session', { rotate: false })
  if (kick === 'ddos-blocked') return retry(conn, k.waitMs, "Blocked by this address's DDoS protection", { rotate: true })
  if (kick === 'backend-unreachable') return retry(conn, 60000, '6b6t could not reach its own server', {})
  if (kick === 'connection-error') return retry(conn, 10000, 'Connection error on 6b6t', {})
  if (kick) return retry(conn, backoff(10000), 'Kicked', {})

  if (conn.playLogins === 0) {
    const held = Date.now() - conn.startedAt
    if (held >= scaled(25000)) {
      // 6b6t sometimes holds a connection ~30s and closes it without a word
      // while an IP is in a verification cooldown. Once may be chance; twice
      // in a row, retrying only makes the cooldown longer.
      G.silentHolds++
      if (G.silentHolds >= 2) {
        return stop(EXIT.SILENT, [
          `6b6t held the connection for ${secs(held)} without letting the bot in, twice in a row.`,
          'This usually means your IP is in a verification cooldown (for example after a',
          '"verify" or "wait N minutes" message). Wait 10-30 minutes, then restart the bot.'
        ])
      }
      return retry(conn, 60000, `6b6t held the connection for ${secs(held)} without letting the bot in`, { rotate: true })
    }
    const code = conn.lastError ? String(conn.lastError.code || conn.lastError.message) : ''
    const why = code ? `Could not connect (${code})` : 'The connection closed before login'
    // An address that refuses or cannot be reached is skipped straight away
    // (alt4 refused every connection on 2026-09-28); backoff only starts once
    // every address has failed in a row.
    if (/^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN)$/.test(code)) {
      return retry(conn, G.failures < SERVER_LIST.length ? 3000 : backoff(10000), why, { rotate: true })
    }
    return retry(conn, backoff(10000), why, {})
  }
  if (conn.endIntent === 'stuck') return retry(conn, 10000, 'Stuck before main', {})
  if (conn.endIntent === 'backup-timeout') return retry(conn, 10000, 'Reconnecting from the backup server', { rotate: false })
  return retry(conn, backoff(10000), `Disconnected (${conn.endIntent || reason})`, {})
}

function verifyLines (k) {
  return [
    '6b6t needs you to verify this connection (VPN / anti-bot check).',
    '',
    k.link ? `  Verify here:  ${k.link}` : '  The verify link is in the kick message above.',
    '',
    'Open that link in a browser on the SAME computer or network this bot runs on,',
    'and complete the check.',
    'After verifying, restart the bot.'
  ]
}

function backoff (base) {
  return Math.min(60000, base * 2 ** Math.min(G.failures, 3))
}

function retry (conn, delayMs, why, { rotate } = {}) {
  if (conn.mainAnnounced) {
    G.failures = 0
    G.failsOnServer = 0
  } else {
    G.failures++
    G.failsOnServer++
  }
  if (G.failures >= MAX_FAILURES) {
    return stop(EXIT.GAVE_UP, [
      `Tried ${G.failures} times in a row without reaching main. Last problem: ${why}.`,
      'Check your internet connection, then restart the bot later.'
    ])
  }
  let note = ''
  const rotateNow = rotate === true || (rotate !== false && G.failsOnServer >= 2)
  if (rotateNow && SERVER_LIST.length > 1) {
    G.serverIndex++
    G.failsOnServer = 0
    const next = SERVER_LIST[G.serverIndex % SERVER_LIST.length]
    note = ` via ${next.host}${next.port === 25565 ? '' : ':' + next.port}`
  }
  const wait = scaled(delayMs)
  log(`${why}. Reconnecting in ${secs(wait)}${note}...`, 'yellow')
  G.reconnectTimer = setTimeout(connect, wait)
}

function stop (code, lines) {
  if (G.stopping) return
  G.stopping = true
  if (G.reconnectTimer) clearTimeout(G.reconnectTimer)
  banner(lines, code === EXIT.OK ? 'green' : code === EXIT.VERIFY ? 'yellow' : 'red')
  let exited = false
  const exit = () => {
    if (exited) return
    exited = true
    process.exitCode = code
    setTimeout(() => process.exit(code), 150) // let the output flush
  }
  const conn = G.conn
  if (conn && conn.bot && !conn.ended) {
    try { conn.bot.once('end', exit) } catch (e) {}
    try { conn.bot.quit() } catch (e) { exit() }
    setTimeout(() => {
      try { conn.bot._client.socket.destroy() } catch (e) {}
      exit()
    }, 3000)
  } else {
    exit()
  }
}

let interrupts = 0
function onInterrupt () {
  if (++interrupts > 1) process.exit(EXIT.OK)
  stop(EXIT.OK, ['Disconnected.'])
}
process.on('SIGINT', onInterrupt)
process.on('SIGTERM', onInterrupt)
process.on('unhandledRejection', (r) => log('(unhandled) ' + ((r && r.message) || r), 'gray'))
process.on('uncaughtException', (e) => {
  log('Unexpected error: ' + ((e && e.stack) || e), 'red')
  stop(EXIT.CRASH, ['The bot hit an unexpected error (shown above). Restart the bot.'])
})

log(`6b6t join bot: ${NAME}, Minecraft ${VERSION}, mineflayer ${PINNED.mineflayer} / minecraft-protocol ${PINNED['minecraft-protocol']} (the map-art bots' versions).`, 'cyan')
connect()
