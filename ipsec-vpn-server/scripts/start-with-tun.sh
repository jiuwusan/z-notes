#!/bin/sh
set -eu

# The image inserts its standard rules at the head of FORWARD, then appends
# DROP. Install these first so they remain ahead of that final DROP.
# Match the XAuth/IKEv2 pool configured through the image's environment.
vpn_subnet="${VPN_XAUTH_NET:-192.168.43.0/24}"
l2tp_subnet="${VPN_L2TP_NET:-192.168.42.0/24}"

iptables -w -C FORWARD -s "$vpn_subnet" -o mihomo -m policy --dir in --pol ipsec -j ACCEPT 2>/dev/null || iptables -w -I FORWARD 1 -s "$vpn_subnet" -o mihomo -m policy --dir in --pol ipsec -j ACCEPT

iptables -w -C FORWARD -i mihomo -d "$vpn_subnet" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -w -I FORWARD 1 -i mihomo -d "$vpn_subnet" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# L2TP payloads arrive on ppp interfaces after IPsec/L2TP decapsulation.
iptables -w -C FORWARD -i ppp+ -s "$l2tp_subnet" -o mihomo -j ACCEPT 2>/dev/null || iptables -w -I FORWARD 1 -i ppp+ -s "$l2tp_subnet" -o mihomo -j ACCEPT

iptables -w -C FORWARD -i mihomo -o ppp+ -d "$l2tp_subnet" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -w -I FORWARD 1 -i mihomo -o ppp+ -d "$l2tp_subnet" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# Keep the original startup process as PID 1 for normal signal handling.
exec "$@"
