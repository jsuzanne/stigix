# Remote Access Guidelines

Accessing your SD-WAN Traffic Generator dashboard securely is critical, especially when deploying in lab environments, branches, or behind corporate firewalls.

## 🚀 Recommended Solutions

### 1. Tailscale (Easiest & Most Secure)
Tailscale creates a secure "Mesh VPN" between your devices. No port forwarding required.
- **Why**: Zero configuration, encrypted by default, works anywhere.
- **Setup**:
  1. Install Tailscale on the host running Docker.
  2. Install Tailscale on your laptop/mobile.
  3. Access the dashboard via the Tailscale machine name or IP (e.g., `http://sdwan-lab:8080`).
- **Link**: [Tailscale Getting Started](https://tailscale.com/kb/1017/install/)

### 2. Cloudflare Tunnel
Connect your dashboard to the internet via Cloudflare's global network without opening ingress ports.
- **Why**: Integrated with SSO/OIDC, DDoS protection, hide your origin IP.
- **Setup**:
  1. Install `cloudflared` on your host.
  2. Create a tunnel pointing to `localhost:8080`.
  3. Map a domain (e.g., `sdwan.yourcompany.com`) to the tunnel.
- **Link**: [Cloudflare Tunnel Guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/)

### 3. Nginx / Traefik Reverse Proxy
Traditional reverse proxy with SSL termination.
- **Why**: Industry standard, customizable, handles multiple services on one IP.
- **Setup**:
  1. Deploy Nginx or Traefik as a container.
  2. Use Let's Encrypt for automatic HTTPS.
  3. Proxy traffic from port 443 to the `stigix:8080`.

---

## 🔒 Security Best Practices

- **Strong JWT Secret**: Ensure you have set a custom `JWT_SECRET` in your `docker-compose.yml`.
- **Admin Password**: Change the default `admin/admin` password immediately after installation.
- **Firewall**: If not using a tunnel/VPN, restrict ingress access to specific source IPs (Management VLAN).
- **HTTPS**: Always use HTTPS if exposing the dashboard to the internet.

## 🌍 Deployment in SD-WAN Networks
If deploying inside an SD-WAN branch:
1. Bind the Web UI to a **Management Interface** or VRF.
2. Ensure the management network has a route back to your access location.
3. Check your **ZTNA (Zero Trust Network Access)** configuration to permit access to the dashboard port.
