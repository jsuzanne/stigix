import {
    Activity,
    Bot,
    Boxes,
    Cpu,
    Gauge,
    GitFork,
    Globe,
    Home,
    Layers,
    LineChart,
    List,
    type LucideIcon,
    Monitor,
    Network,
    Phone,
    Radio,
    Repeat,
    ScanSearch,
    Server,
    Settings,
    Shield,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Zap
} from 'lucide-react';

export interface NavItemConfig {
    id: string; // Internal view id (e.g. 'home', 'dashboard', 'security', 'vyos', etc.)
    label: string;
    icon: LucideIcon;
    route: string; // e.g. '#/home', '#/validate/security'
    description?: string;
    group?: string; // Group header in flyout (e.g. 'Module Configuration')
    leaderOnly?: boolean;
    featureFlag?: 'xfr_enabled' | 'pcap_enabled' | 'copilot_enabled';
    runningKey?: string; // Key in active tasks state
    subTab?: string; // Target sub-tab when navigating to settings or vyos
}

export interface NavDomainConfig {
    id: 'home' | 'generate' | 'validate' | 'observe' | 'network' | 'settings';
    label: string;
    icon: LucideIcon;
    subtitle?: string;
    items: NavItemConfig[]; // If 1 item -> direct navigation. If >1 items -> floating flyout panel
}

export const STIGIX_NAVIGATION_DOMAINS: NavDomainConfig[] = [
    {
        id: 'home',
        label: 'Home',
        icon: Home,
        items: [
            {
                id: 'home',
                label: 'System Overview',
                icon: Home,
                route: '#/home',
                description: 'Real-time Command Center, System Health Matrix & cluster telemetry'
            }
        ]
    },
    {
        id: 'generate',
        label: 'Generate',
        icon: Zap,
        subtitle: 'Produce realistic load & enterprise workloads',
        items: [
            {
                id: 'dashboard',
                label: 'SaaS Traffic Generator',
                icon: Activity,
                route: '#/generate/saas',
                description: 'Multi-app background SaaS traffic load and APM telemetry',
                runningKey: 'traffic'
            },
            {
                id: 'custom_apps',
                label: 'Custom TCP/HTTP Apps',
                icon: Boxes,
                route: '#/generate/custom-apps',
                description: 'Enterprise private apps emulation across SD-WAN overlays and breakouts',
                runningKey: 'custom_apps'
            },
            {
                id: 'voice',
                label: 'Voice Simulation',
                icon: Phone,
                route: '#/generate/voice',
                description: 'RTP voice call emulation, MOS scoring and jitter measurement',
                runningKey: 'voice'
            },
            {
                id: 'iot',
                label: 'IoT Device Emulation',
                icon: Cpu,
                route: '#/generate/iot',
                description: 'Physical IoT device emulation & security attack profiles (Real-on-Wire)',
                runningKey: 'iot'
            },
            {
                id: 'pcap_replay',
                label: 'PCAP Replay Engine',
                icon: Repeat,
                route: '#/generate/pcap-replay',
                description: 'Stateful L7 PCAP replay with zero-config profiles & SASE verdicts',
                featureFlag: 'pcap_enabled'
            }
        ]
    },
    {
        id: 'validate',
        label: 'Validate',
        icon: ShieldCheck,
        subtitle: 'Validate SASE policies, performance & SLA path behavior',
        items: [
            {
                id: 'security',
                label: 'Security Validation',
                icon: Shield,
                route: '#/validate/security',
                description: 'Validate SASE / NGFW security policy enforcement (URL, DNS, EICAR, Threats)'
            },
            {
                id: 'performance',
                label: 'Digital Experience (DEM)',
                icon: LineChart,
                route: '#/validate/dem',
                description: 'Synthetic path probes, SLAs and user digital experience monitoring'
            },
            {
                id: 'convergence',
                label: 'Failover Monitoring',
                icon: GitFork,
                route: '#/validate/failover',
                description: 'Sub-second blackout, path convergence and failover packet loss tracking',
                runningKey: 'failover'
            }
        ]
    },
    {
        id: 'observe',
        label: 'Observe',
        icon: ScanSearch,
        subtitle: 'Deep telemetry inspection & live packet analysis',
        items: [
            {
                id: 'packet_capture',
                label: 'Packet Capture',
                icon: Radio,
                route: '#/observe/capture',
                description: 'Live BPF packet sniffer & Wireshark-grade 3-pane web inspector'
            },
            {
                id: 'events',
                label: 'Live Events Stream',
                icon: List,
                route: '#/observe/events',
                description: 'Streaming real-time network, security, and orchestrator event logs'
            }
        ]
    },
    {
        id: 'network',
        label: 'Network',
        icon: Globe,
        subtitle: 'SD-WAN topology, router control & cluster fleet',
        items: [
            {
                id: 'topology',
                label: 'Topology Map',
                icon: Network,
                route: '#/network/topology',
                description: 'Visual underlay mesh, SD-WAN tunnels, and active SASE circuit paths'
            },
            {
                id: 'vyos',
                label: 'VyOS Router Control',
                icon: Monitor,
                route: '#/network/vyos',
                description: 'Inject WAN impairments (latency, loss, jitter) & orchestrate routers'
            },
            {
                id: 'fleet',
                label: 'Fleet Mesh Nodes',
                icon: Server,
                route: '#/network/fleet',
                description: 'Centralized cluster observability, peer updates & maintenance',
                leaderOnly: true
            }
        ]
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        subtitle: 'Platform configuration, controller & cluster settings',
        items: [
            {
                id: 'settings',
                subTab: 'distribution',
                label: 'Traffic Distribution',
                icon: SlidersHorizontal,
                route: '#/settings/distribution',
                description: 'Weights & SaaS traffic load ratios by category or app',
                group: 'Simulation Profiles'
            },
            {
                id: 'settings',
                subTab: 'probes',
                label: 'Synthetic Probes',
                icon: Activity,
                route: '#/settings/probes',
                description: 'Synthetic path probe targets, SLAs, intervals & HTTP URLs',
                group: 'Simulation Profiles'
            },
            {
                id: 'settings',
                subTab: 'custom-tcp',
                label: 'Custom TCP Apps',
                icon: Boxes,
                route: '#/settings/custom-tcp',
                description: 'Enterprise TCP/HTTP workloads & private branch apps',
                group: 'Simulation Profiles'
            },
            {
                id: 'settings',
                subTab: 'convergence',
                label: 'Failover Settings',
                icon: GitFork,
                route: '#/settings/failover',
                description: 'Blackout detection thresholds, alerting & path recovery',
                group: 'Simulation Profiles'
            },
            {
                id: 'settings',
                subTab: 'targets',
                label: 'Stigix Targets',
                icon: Layers,
                route: '#/settings/targets',
                description: 'Underlay WAN destinations matrix & probe endpoints',
                group: 'Cluster & Controller'
            },
            {
                id: 'settings',
                subTab: 'registry',
                label: 'Target Controller',
                icon: Globe,
                route: '#/settings/target-controller',
                description: 'Cluster mesh enrollment, join tokens & leader peering',
                group: 'Cluster & Controller'
            },
            {
                id: 'settings',
                subTab: 'prisma-api',
                label: 'Prisma SASE API',
                icon: Shield,
                route: '#/settings/prisma-api',
                description: 'Palo Alto Strata/Prisma credentials, TSG & telemetry sync',
                group: 'Integrations & AI'
            },
            {
                id: 'settings',
                subTab: 'api-studio',
                label: 'API Studio',
                icon: Globe,
                route: '#/settings/api-studio',
                description: 'Interactive OpenAPI test console & curl/Python snippets',
                group: 'Integrations & AI'
            },
            {
                id: 'settings',
                subTab: 'mcp',
                label: 'AI & Copilot Settings',
                icon: Sparkles,
                route: '#/settings/ai-copilot',
                description: 'Anthropic Claude API key, model options & tool permissions',
                group: 'Integrations & AI',
                featureFlag: 'copilot_enabled'
            },
            {
                id: 'settings',
                subTab: 'system',
                label: 'System Information',
                icon: Monitor,
                route: '#/settings/system',
                description: 'Hardware resources, OS kernel, Docker & interfaces',
                group: 'System & Maintenance'
            },
            {
                id: 'settings',
                subTab: 'maintenance',
                label: 'Maintenance & Updates',
                icon: Server,
                route: '#/settings/maintenance',
                description: 'One-click image upgrades, Docker prune & fleet sync',
                group: 'System & Maintenance'
            }
        ]
    }
];

export const BOTTOM_UTILITIES = [
    {
        id: 'copilot',
        label: 'AI Copilot',
        icon: Bot,
        shortcut: '⌘J'
    }
];
