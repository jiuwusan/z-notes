const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/start-with-tun.sh');
const shell = process.env.TEST_SHELL || 'sh';
const shellPath = value => value.replace(/\\/g, '/')
  .replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-tun-test-'));
  // Stand in for Linux iptables: keep installed rules between wrapper runs.
  fs.writeFileSync(path.join(dir, 'iptables'), `#!/bin/sh
set -eu
[ "$1" = -w ] && shift
operation="$1"; shift
chain="$1"; shift
if [ "$operation" = -I ]; then
  [ "$1" = 1 ] || exit 3
  shift
fi
rule="$chain $*"
case "$operation" in
  -C) grep -Fqx -- "$rule" "$TEST_STATE" ;;
  -I)
    [ "$TEST_FAIL_INSERT" = 0 ] || exit 2
    printf '%s\\n' "$rule" >> "$TEST_STATE"
    ;;
  *) exit 3 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'upstream.sh'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$TEST_STARTED"\nexit 17\n');
  fs.writeFileSync(path.join(dir, 'rules'), '');
  const env = {
    ...process.env,
    TEST_STATE: shellPath(path.join(dir, 'rules')),
    TEST_STARTED: shellPath(path.join(dir, 'started')),
    TEST_BIN: shellPath(dir),
    VPN_XAUTH_NET: '',
    VPN_L2TP_NET: '',
    TEST_FAIL_INSERT: '0',
  };
  return {
    dir,
    run(extra = {}) {
      return spawnSync(shell, ['-c',
        'export PATH="$TEST_BIN:$PATH"; exec sh "$1" sh "$2" forwarded-argument',
        'test', shellPath(script), shellPath(path.join(dir, 'upstream.sh')),
      ], { env: { ...env, ...extra }, encoding: 'utf8' });
    },
    rules() { return fs.readFileSync(path.join(dir, 'rules'), 'utf8').trim().split('\n'); },
    cleanup() { fs.rmSync(dir, { recursive: true }); },
  };
}

test('covers XAuth/IKEv2 and L2TP forwarding and preserves upstream arguments/exit status', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(f.rules(), [
      'FORWARD -s 192.168.43.0/24 -o mihomo -m policy --dir in --pol ipsec -j ACCEPT',
      'FORWARD -i mihomo -d 192.168.43.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
      'FORWARD -i ppp+ -s 192.168.42.0/24 -o mihomo -j ACCEPT',
      'FORWARD -i mihomo -o ppp+ -d 192.168.42.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
    ]);
    assert.equal(fs.readFileSync(path.join(f.dir, 'started'), 'utf8'), 'forwarded-argument\n');
  } finally { f.cleanup(); }
});

test('restarting with retained firewall rules does not add duplicates', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 17);
    const installed = f.rules();
    assert.equal(f.run().status, 17);
    assert.deepEqual(f.rules(), installed);
  } finally { f.cleanup(); }
});

test('honors a custom XAuth address pool', () => {
  const f = fixture();
  try {
    const result = f.run({ VPN_XAUTH_NET: '192.168.88.0/24' });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(f.rules(), [
      'FORWARD -s 192.168.88.0/24 -o mihomo -m policy --dir in --pol ipsec -j ACCEPT',
      'FORWARD -i mihomo -d 192.168.88.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
      'FORWARD -i ppp+ -s 192.168.42.0/24 -o mihomo -j ACCEPT',
      'FORWARD -i mihomo -o ppp+ -d 192.168.42.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
    ]);
  } finally { f.cleanup(); }
});

test('honors a custom L2TP subnet independently of XAuth/IKEv2', () => {
  const f = fixture();
  try {
    const result = f.run({ VPN_L2TP_NET: '192.168.77.0/24' });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(f.rules(), [
      'FORWARD -s 192.168.43.0/24 -o mihomo -m policy --dir in --pol ipsec -j ACCEPT',
      'FORWARD -i mihomo -d 192.168.43.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
      'FORWARD -i ppp+ -s 192.168.77.0/24 -o mihomo -j ACCEPT',
      'FORWARD -i mihomo -o ppp+ -d 192.168.77.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
    ]);
  } finally { f.cleanup(); }
});

test('does not start VPN when installing forwarding rules fails', () => {
  const f = fixture();
  try {
    const result = f.run({ TEST_FAIL_INSERT: '1' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(fs.existsSync(path.join(f.dir, 'started')), false);
  } finally { f.cleanup(); }
});
