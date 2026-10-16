# IKEv2 用户管理指南

适用于本目录的 `hwdsl2/ipsec-vpn-server:debian` 部署。以下命令在 NAS 的 Docker 宿主机执行；涉及相对路径或 `docker compose` 时，先进入本目录。

本镜像的 IKEv2 使用客户端证书认证。一个“用户”实际对应一套客户端证书和私钥，不使用 L2TP/XAuth 的用户名、密码或 IPsec PSK。建议每台设备单独创建证书，以便独立吊销。[上游说明](https://github.com/hwdsl2/docker-ipsec-vpn-server#configure-and-use-ikev2-vpn)

## 部署信息

| 项目 | 当前配置 |
| --- | --- |
| VPN 容器 | `ipsec-vpn-server` |
| Mihomo 容器 | `ipsec-vpn-mihomo` |
| 管理脚本 | `/opt/src/ikev2.sh` |
| 容器证书目录 | `/etc/ipsec.d` |
| 宿主机持久化目录 | `./data/ipsec.d` |
| 默认客户端地址池 | `192.168.43.10` 至 `192.168.43.250` |

IKEv2/XAuth 模式下，服务器不需要拥有 `192.168.43.x` 的接口地址。管理操作也不需要为每位用户单独增加路由或防火墙规则，现有启动脚本已按客户端网段放行。

## 检查管理入口

确认容器正在运行，查看当前脚本帮助和客户端列表：

```sh
docker compose ps
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh -h
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --listclients
```

脚本必须在已完成 IKEv2 初始化的容器中使用。若提示尚未配置 IKEv2，先检查容器启动日志中的初始化结果；不要将重新初始化当作新增用户操作。

## 新增客户端

示例为手机创建名为 `zkd-phone` 的客户端：

```sh
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --addclient zkd-phone
```

名称只使用英文字母、数字、连字符和下划线，不以连字符开头，最长 64 个字符。可以使用 `zkd-phone`、`zkd-laptop` 等名称区分设备。

脚本使用默认选项生成并导出客户端配置，成功后会显示文件位置和导入信息。如果需要自定义新客户端证书的有效期，使用交互菜单：

```sh
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh
```

选择新增客户端，按提示完成配置。导入密码用于保护导出的证书文件，不是 VPN 用户登录密码。[管理命令说明](https://github.com/hwdsl2/docker-ipsec-vpn-server#configure-and-use-ikev2-vpn)

## 导出和分发配置

已有客户端需要重新下载配置时，执行：

```sh
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --exportclient zkd-phone
```

Docker 版本将导出文件放在 `/etc/ipsec.d`，本部署对应宿主机的 `./data/ipsec.d`。常见文件用途如下，具体以脚本输出为准：

| 文件 | 常见用途 |
| --- | --- |
| `zkd-phone.p12` | 客户端证书和私钥，例如 Windows 导入 |
| `zkd-phone.mobileconfig` | Apple 设备描述文件 |
| `zkd-phone.sswan` | Android strongSwan 配置 |

可以直接从宿主机持久化目录取文件，也可以只复制所需文件到宿主机用户目录：

```sh
umask 077
mkdir -p "$HOME/ikev2-clients"
docker cp ipsec-vpn-server:/etc/ipsec.d/zkd-phone.p12 "$HOME/ikev2-clients/zkd-phone.p12"
```

证书及配置文件包含设备连接凭据，应通过可信方式交付给对应用户，不提交到 Git。客户端使用脚本输出中的服务器地址，导入密码也以脚本实际输出为准。平台导入步骤见[官方客户端指南](https://github.com/hwdsl2/setup-ipsec-vpn/blob/master/docs/ikev2-howto-zh.md#配置-ikev2-vpn-客户端)。

## 吊销客户端

设备丢失、凭据泄露或用户不再需要访问时，先核对名称，再吊销证书：

```sh
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --listclients
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --revokeclient zkd-phone
```

按提示确认操作。上游脚本将证书加入吊销列表并重新加载 CRL；不要只通过删除导出文件来停用设备。[吊销实现](https://github.com/hwdsl2/setup-ipsec-vpn/blob/master/extras/ikev2setup.sh)

吊销后验证旧配置无法重新连接。已建立的会话不能仅凭“吊销成功”认定已断开；如果需要立即统一断开当前连接，可以重启 VPN 容器，但会影响所有 VPN 用户：

```sh
docker compose restart ipsec-vpn-server
```

替换设备时使用新名称，例如 `zkd-phone-v2`，为新证书重新导出和分发配置。

## 删除客户端

`--deleteclient` 用于清理服务器上的客户端证书和私钥，**不能替代吊销**。需要停用客户端时，先完成上一节的吊销操作，再决定是否删除：

```sh
docker exec -it ipsec-vpn-server /opt/src/ikev2.sh --deleteclient zkd-phone
```

不要删除服务器证书、CA 或整个证书目录来清理某位用户。[删除与吊销的区别](https://github.com/hwdsl2/setup-ipsec-vpn/blob/master/docs/ikev2-howto-zh.md#删除客户端证书)

## 备份证书数据

`./data/ipsec.d` 保存证书数据库、私钥、IKEv2 配置和吊销数据。重建容器时保留该目录，避免已有客户端因证书数据丢失而需要重新配置。

为了得到一致的目录备份，可以在维护窗口停止 VPN 容器后打包，再恢复运行。停止期间所有 VPN 连接会断开：

```sh
umask 077
mkdir -p "$HOME/vpn-backups"
docker compose stop ipsec-vpn-server
sudo tar -czf "$HOME/vpn-backups/ipsec.d-$(date +%Y%m%d-%H%M%S).tar.gz" -C ./data ipsec.d
docker compose start ipsec-vpn-server
```

如果打包失败，也应恢复启动容器并处理错误。备份放在仓库外的受限目录，并另外安全保存 `data/vpn.env` 和部署配置。恢复旧备份时必须核对之后发生的证书吊销，避免将旧的授权状态一并恢复。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 提示客户端名称已存在 | 需要原配置时使用 `--exportclient`；新设备使用新名称 |
| 导出文件要求密码 | 使用脚本输出的导入密码，不使用 L2TP/XAuth 密码 |
| 修改 `VPN_USER` 后 IKEv2 用户没有变化 | IKEv2 管理客户端证书；使用本指南的客户端管理命令 |
| 能连接但无法上网 | 检查 VPN 转发规则、客户端 DNS 和 Mihomo 出口 |
| 删除了客户端仍能连接 | 删除不等于吊销，停用设备应使用 `--revokeclient` |

连接状态、转发计数和最近的代理错误可分别查看：

```sh
docker exec ipsec-vpn-server ipsec status
docker exec ipsec-vpn-server iptables -nvL FORWARD --line-numbers
docker logs --since 5m ipsec-vpn-mihomo
```

正常的 IKEv2 会话应出现在 `ikev2-cp` 连接下。当前 Mihomo 日志级别为 `warning`，成功请求通常不会逐条记录。完整 VPN 容器日志可能包含初始化凭据，分享诊断输出前应隐藏敏感信息。
