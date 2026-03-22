# VyOS Integration Verification from the Stigix Docker Container

This guide explains how to verify that the **VyOS control script** (`vyos_sdwan_ctl.py`) is working correctly from within the **Stigix** Docker environment.

---

## 1. Access the Stigix Container

Open a shell inside the running `stigix` container:

```bash
docker exec -it stigix bash
```

Your prompt should change to:

```bash
root@UbuntuBR8:/app#
```


---

## 2. Explore the Application Structure

List the contents of the `/app` directory to see the available components:

```bash
ls
```

You should notice important directories such as:

- `engines` — contains emulators and traffic tools
- `vyos` — contains scripts for controlling VyOS
- `iot`, `mcp-server`, `stigix-all-in-one` — other Stigix modules

---

## 3. Navigate to VyOS Control Scripts

Enter the VyOS directory:

```bash
cd vyos
ls
```

You will find Python scripts such as:

- `vyos_sdwan_ctl.py`

---

## 4. Display Script Help and Usage

Run the help command to inspect supported options:

```bash
./vyos_sdwan_ctl.py -h
```

Common commands include:

- `get-info` — retrieve general router information
- `simple-block` / `simple-unblock` — manage blackhole routes (`ip route null`)
- `set-qos` — configure simulated latency, loss, or QoS metrics

The VyOS API supports operations for reading information and applying configuration through its HTTP API endpoints, including `/retrieve` and `/configure`.

---

## 5. Example: Retrieve Router Information

Run the following command to verify connectivity to VyOS:

```bash
./vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET get-info
```

**Expected output (example):**

```json
{
  "success": true,
  "version": "1.5",
  "interfaces": [
    {"name": "eth0", "description": "MGMT", "address": ["192.168.122.210/24"], "status": "up"},
    {"name": "eth1", "description": "DC1 LAN", "address": ["192.168.201.10/24"], "status": "up"},
    {"name": "eth2", "description": "DC1 Legacy MPLS", "address": ["192.168.170.10/24"], "status": "up"},
    {"name": "eth3", "description": "DC1 INTERNET EXIT", "address": ["192.168.81.254/24"], "status": "up"},
    {"name": "eth4", "description": "DC1 DCI to DC2", "address": ["192.168.200.3/24"], "status": "up"},
    {"name": "eth5", "description": "DC1 Slow APP LAN", "address": ["192.168.203.10/24"], "status": "up"},
    {"name": "eth6", "description": "LAN 201", "address": ["10.10.201.3/24"], "status": "up"}
  ],
  "hostname": "vyoslandc1"
}
```

If this output appears, the API key and connection to the VyOS router are correctly set up.

---

## 6. Next Steps

Once verified, you can use other commands such as:

```bash
# List all current blackhole routes
./vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET get-blocks

# Apply a network block
./vyos_sdwan_ctl.py --host 192.168.122.210 --key SUPERSECRET simple-block --ip 192.168.203.100
```

Refer to `VYOS_FIREWALL_INTEGRATION.md` for legacy firewall integration details, though `simple-block` is the preferred method for blocking traffic.

---

## 7. Troubleshooting

### 7.1. The API returns `Not Found`

If the VyOS HTTP API returns `{"detail":"Not Found"}`, the request is usually hitting the wrong endpoint or the API service is not exposed the way the client expects. VyOS documents its HTTP API endpoints under `/retrieve`, `/configure`, and related paths, so the host, port, and URL path must match the API layout exactly.

### 7.2. The API key is rejected

If `get-info` fails with an authentication error, verify that the API key is correct and that it matches the key configured on the VyOS side. VyOS API requests use the key as part of the request payload for authenticated operations.

### 7.3. HTTPS or certificate issues

If the script fails on TLS verification, try running without strict certificate validation only for lab testing, or confirm the correct certificate chain on the VyOS side. VyOS supports HTTPS API usage, and certificate handling can affect whether client requests succeed.

### 7.4. Interface constraints

If QoS commands fail, check that the interface name exists and is up. In your output, valid interfaces include `eth0` through `eth6`, with names such as `MGMT`, `DC1 LAN`, and `DC1 INTERNET EXIT`.

### 7.5. Version mismatch

Some commands depend on the VyOS version. Your sample output shows version `1.5`, so make sure the script is run with the matching version flag when needed, especially for QoS operations. Firewall operations (`fw-block`) are less reliable and should be avoided in favor of `simple-block`. VyOS API behavior and supported operations can vary between releases.

### 7.6. API service not enabled

If the client cannot connect at all, confirm that the VyOS HTTP API service is enabled and reachable from the Docker container. VyOS’s official API documentation shows that the service must be available and listening for requests to `/retrieve` and `/configure` before automation can work.

---

## 8. Quick Validation Checklist

- Container access works with `docker exec -it stigix bash`.
- `vyos_sdwan_ctl.py -h` shows the expected commands.
- `get-info` returns `success: true`.
- The host IP is reachable from the container.
- The API key matches the VyOS configuration.
- The interface names used by the script exist on the VyOS box.

---

<div align="center">⁂</div>

[^1]: https://www.reddit.com/r/vyos/comments/1hnx6th/https_api_not_working/
[^2]: https://docs.vyos.io/en/latest/automation/vyos-api.html
[^3]: https://docs.vyos.io/en/latest/troubleshooting/
[^4]: https://vyos.dev/T2612
[^5]: https://www.monotux.tech/posts/2023/10/vyos-api/
[^6]: https://forum.vyos.io/t/https-api-for-generate-not-working-properly-for-wireguard-interface/17099
[^7]: https://docs.rolling.vyos.naho.moe/en/1.5-rolling-202408300023/automation/vyos-api.html
[^8]: https://docs.vyos.io/en/latest/configuration/service/https.html
[^9]: https://www2.filewo.net/wordpress/2025/02/24/4023/
[^10]: https://forum.vyos.io/t/http-api-for-show/3922
[^11]: https://www.reddit.com/r/vyos/comments/1cjyua8/possible_issue_for_nat_configuration_via_api/
[^12]: https://forum.vyos.io/t/interface-status-retrieval-via-api-call/15265
[^13]: https://vyos.dev/w/user-guide/?v=2
[^14]: https://opennix.org/docs/vyos/services/vyos-https/

