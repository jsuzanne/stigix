import type { ApiPreset } from '../../types/api-studio';

export const API_PRESETS: ApiPreset[] = [
    // --- Prisma SD-WAN (CloudGenix) ---
    {
        id: 'prisma-list-sites',
        name: 'List All Sites',
        category: 'Prisma SD-WAN',
        description: 'Fetch all ION branch & DC sites on the Prisma SD-WAN tenant',
        method: 'GET',
        url: '/sdwan/v2.1/api/sites',
        autoAuth: 'sase'
    },
    {
        id: 'prisma-list-elements',
        name: 'List ION Elements (Appliances)',
        category: 'Prisma SD-WAN',
        description: 'Fetch all hardware and virtual ION appliances with status',
        method: 'GET',
        url: '/sdwan/v2.1/api/elements',
        autoAuth: 'sase'
    },
    {
        id: 'prisma-list-apps',
        name: 'List Custom Applications (AppDefs)',
        category: 'Prisma SD-WAN',
        description: 'Retrieve custom application definitions created in Prisma SD-WAN',
        method: 'GET',
        url: '/sdwan/v2.1/api/appdefs',
        autoAuth: 'sase'
    },
    {
        id: 'prisma-create-app',
        name: 'Create Custom App Definition',
        category: 'Prisma SD-WAN',
        description: 'Create a new L7 custom application definition in Prisma SD-WAN',
        method: 'POST',
        url: '/sdwan/v2.1/api/appdefs',
        autoAuth: 'sase',
        body: {
            name: "STIGIX_CUSTOM_ERP",
            display_name: "Stigix Custom ERP App",
            app_type: "custom",
            category: "business_systems",
            sub_category: "enterprise_resource_planning",
            description: "Custom ERP application created from Stigix API Studio",
            tcp_rules: [
                {
                    port: "3200"
                }
            ]
        }
    },
    {
        id: 'prisma-query-flowmetrics',
        name: 'Query SD-WAN Flow Metrics',
        category: 'Prisma SD-WAN',
        description: 'Query live and historical flow metrics with path and bandwidth details',
        method: 'POST',
        url: '/sdwan/v2.1/api/flowmetrics',
        autoAuth: 'sase',
        body: {
            metrics: ["bandwidth", "flow_count"],
            interval: "5min",
            start_time: new Date(Date.now() - 3600 * 1000).toISOString(),
            end_time: new Date().toISOString()
        }
    },

    // --- Palo Alto SCM (Strata Cloud Manager) ---
    {
        id: 'scm-query-traffic-logs',
        name: 'Query SLS Traffic Logs',
        category: 'Palo Alto SCM',
        description: 'Query Strata Logging Service for recent firewall / SASE traffic logs',
        method: 'POST',
        url: '/logging-service/v2/query',
        autoAuth: 'sase',
        body: {
            query: "action eq 'allow' or action eq 'deny'",
            startTime: Math.floor((Date.now() - 3600 * 1000) / 1000),
            endTime: Math.floor(Date.now() / 1000),
            limit: 20
        }
    },

    // --- VyOS SD-WAN ---
    {
        id: 'vyos-show-interfaces',
        name: 'Show Network Interfaces',
        category: 'VyOS SD-WAN',
        description: 'Query VyOS router interface status, IPs, and link states via REST API',
        method: 'POST',
        url: '/show',
        autoAuth: 'vyos',
        body: {
            op: "show",
            path: ["interfaces"]
        }
    },
    {
        id: 'vyos-show-routes',
        name: 'Show IP Route Table',
        category: 'VyOS SD-WAN',
        description: 'Query active routing table and next hops on VyOS router',
        method: 'POST',
        url: '/show',
        autoAuth: 'vyos',
        body: {
            op: "show",
            path: ["ip", "route"]
        }
    },

    // --- Stigix Platform ---
    {
        id: 'stigix-get-topology',
        name: 'Get Discovered Topology',
        category: 'Stigix Platform',
        description: 'Fetch current SD-WAN and peer underlay topology from Stigix backend',
        method: 'GET',
        url: '/api/topology',
        autoAuth: 'stigix'
    },
    {
        id: 'stigix-get-system-health',
        name: 'System Health & Engine Status',
        category: 'Stigix Platform',
        description: 'Fetch real-time health metrics of all Stigix micro-engines',
        method: 'GET',
        url: '/api/system/health',
        autoAuth: 'stigix'
    },
    {
        id: 'stigix-get-custom-apps',
        name: 'List Local Custom TCP Apps',
        category: 'Stigix Platform',
        description: 'Fetch all configured Custom TCP applications and listener sessions',
        method: 'GET',
        url: '/api/custom-tcp-apps/summary/all',
        autoAuth: 'stigix'
    },

    // --- External Probes ---
    {
        id: 'probe-cloudflare-target',
        name: 'Ping Cloudflare Target Worker',
        category: 'External Probes',
        description: 'Test connectivity and latency to Stigix Cloudflare edge target',
        method: 'GET',
        url: 'https://stigix-target.jlsuzanne.workers.dev/__down?bytes=1024',
        autoAuth: 'none'
    },
    {
        id: 'probe-eicar-test',
        name: 'EICAR Anti-Malware Test',
        category: 'External Probes',
        description: 'Send test request to EICAR test string to validate threat prevention',
        method: 'GET',
        url: 'https://secure.eicar.org/eicar.com.txt',
        autoAuth: 'none'
    }
];
