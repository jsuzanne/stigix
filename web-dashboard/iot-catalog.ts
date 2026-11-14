import fs from 'fs';
import path from 'path';

export interface CatalogCVEEntry {
    cve_id: string;
    cvss: number;
    severity: string;
    description?: string;
}

export interface CatalogArchetype {
    key: string; // e.g. "baxter healthcare::infusion pump"
    vendor: string;
    type: string;
    model: string;
    vertical: 'healthcare' | 'industrial' | 'retail' | 'smart_building' | 'enterprise';
    name_prefix: string;
    ouis: string[]; // lowercase "xx:xx:xx"
    os_versions: string[];
    firmware_versions: string[];
    protocols: string[];
    dhcp_vendor_class_id: string;
    dhcp_param_req_list: number[];
    risk_score: number;
    risk_level: string;
    has_ics_cert: boolean;
    cves: CatalogCVEEntry[];
    apt_groups: string[];
    source: string;
    updated_at: string;
}

export interface IoTCatalogDatabase {
    version: string;
    updated_at: string;
    total_imports: number;
    archetypes: Record<string, CatalogArchetype>;
}

export interface CatalogHarvestReport {
    source: string;
    scanned_devices: number;
    oui_resolved_vendors: number;
    new_vendors_count: number;
    new_vendors_list: string[];
    new_profiles_count: number;
    new_profiles_list: string[];
    enriched_profiles_count: number;
    new_ouis_count: number;
    new_cves_count: number;
    new_cves_sample: string[];
    catalog_totals: {
        vendors: number;
        profiles: number;
        ouis: number;
        cves: number;
        ieee_oui_database: number;
    };
}

export interface FleetBlueprintItem {
    archetype: CatalogArchetype;
    count: number;
    custom_prefix?: string;
}

export interface FleetGenerateOptions {
    vertical?: string;
    prompt?: string;
    count: number;
    badBehaviorPct: number;
    existingMacs?: Set<string>;
}

export interface FleetGenerateResult {
    devices: any[];
    scenario_title: string;
    engine_mode: 'llm_blueprint' | 'semantic_compiler' | 'vertical_preset';
    blueprint_summary: Array<{
        vendor: string;
        type: string;
        model: string;
        oui: string;
        os: string;
        firmware: string;
        count: number;
    }>;
}

const CURATED_ARCHETYPES: Omit<CatalogArchetype, 'key' | 'source' | 'updated_at'>[] = [
    // ==================== HEALTHCARE / IoMT ====================
    {
        vendor: 'Baxter Healthcare',
        type: 'Infusion Pump',
        model: 'Sigma Spectrum Infusion Pump',
        vertical: 'healthcare',
        name_prefix: 'ICU-PUMP-BAXTER',
        ouis: ['00:22:58', '00:19:f5'],
        os_versions: ['VxWorks Medical RTOS 6.8'],
        firmware_versions: ['v8.02.01-WBM'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp', 'lldp'],
        dhcp_vendor_class_id: 'Baxter-SigmaSpectrum-WBM',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 88,
        risk_level: 'Critical',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2020-12042', cvss: 9.8, severity: 'Critical', description: 'Baxter Sigma Spectrum WBM credential exposure & RCE' },
            { cve_id: 'CVE-2022-26390', cvss: 8.2, severity: 'High', description: 'Infusion pump wireless battery module buffer overflow' }
        ],
        apt_groups: ['FIN12', 'Wizard Spider']
    },
    {
        vendor: 'Philips Healthcare',
        type: 'Patient Monitor',
        model: 'IntelliVue MX800 Patient Monitor',
        vertical: 'healthcare',
        name_prefix: 'ICU-MON-PHILIPS',
        ouis: ['00:01:e3', '00:90:64'],
        os_versions: ['Philips Medical RTOS'],
        firmware_versions: ['Rev M.02.04'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'mdns', 'ntp', 'lldp'],
        dhcp_vendor_class_id: 'Philips-IntelliVue-MX',
        dhcp_param_req_list: [1, 3, 6, 15, 42, 43],
        risk_score: 79,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2020-25191', cvss: 8.8, severity: 'High', description: 'Philips IntelliVue patient monitor unauthenticated LAN access' },
            { cve_id: 'CVE-2018-10631', cvss: 8.1, severity: 'High', description: 'Medical telemetry firmware modification vulnerability' }
        ],
        apt_groups: ['Orangeworm']
    },
    {
        vendor: 'Siemens Healthineers',
        type: 'MRI Scanner',
        model: 'MAGNETOM Altea 1.5T MRI',
        vertical: 'healthcare',
        name_prefix: 'RAD-MRI-SIEMENS',
        ouis: ['00:a0:03', '00:0e:8c'],
        os_versions: ['Windows 10 IoT Enterprise LTSC'],
        firmware_versions: ['syngo MR XA31A'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp', 'lldp'],
        dhcp_vendor_class_id: 'MSFT 5.0',
        dhcp_param_req_list: [1, 15, 3, 6, 44, 46, 47, 31, 33, 249, 43, 252],
        risk_score: 85,
        risk_level: 'Critical',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2022-38465', cvss: 9.3, severity: 'Critical', description: 'Siemens Healthineers syngo DICOM service remote code execution' },
            { cve_id: 'CVE-2021-44228', cvss: 10.0, severity: 'Critical', description: 'Apache Log4j2 JNDI injection in medical imaging server' }
        ],
        apt_groups: ['Orangeworm', 'Lazarus Group']
    },
    {
        vendor: 'GE Healthcare',
        type: 'Patient Monitor',
        model: 'CARESCAPE B650 Vital Signs Monitor',
        vertical: 'healthcare',
        name_prefix: 'ER-CARESCAPE-GE',
        ouis: ['00:00:5a', '00:09:9b'],
        os_versions: ['GE Embedded Linux 4.14'],
        firmware_versions: ['v3.2.4-CS'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp', 'lldp'],
        dhcp_vendor_class_id: 'GE-CARESCAPE-B650',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 82,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2020-6965', cvss: 9.8, severity: 'Critical', description: 'GE Healthcare CARESCAPE monitor exposed SSH & default key' },
            { cve_id: 'CVE-2020-25179', cvss: 7.5, severity: 'High', description: 'HL7/DICOM medical telemetry parsing vulnerability' }
        ],
        apt_groups: ['Orangeworm']
    },
    {
        vendor: 'Draeger Medical',
        type: 'Anesthesia Workstation',
        model: 'Infinity Delta XL Patient Monitor',
        vertical: 'healthcare',
        name_prefix: 'OR-DRAEGER-INF',
        ouis: ['00:0e:8c', '00:13:95'],
        os_versions: ['VxWorks 6.9 Medical'],
        firmware_versions: ['VF9.1.2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp', 'lldp'],
        dhcp_vendor_class_id: 'Draeger-Infinity-Med',
        dhcp_param_req_list: [1, 3, 6, 15, 42],
        risk_score: 76,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2019-5622', cvss: 8.8, severity: 'High', description: 'Draeger Infinity Delta network buffer overflow' }
        ],
        apt_groups: ['Orangeworm']
    },
    {
        vendor: 'Axis Communications',
        type: 'IP Camera',
        model: 'AXIS P3245-V Dome Camera',
        vertical: 'healthcare',
        name_prefix: 'CAM-AXIS-CLINIC',
        ouis: ['00:40:8c', 'ac:cc:8e', 'b8:a4:4f'],
        os_versions: ['AXIS OS 9.80.3.1'],
        firmware_versions: ['9.80.3.1'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'mdns', 'ntp', 'ssdp', 'lldp'],
        dhcp_vendor_class_id: 'Axis-Video-VAPIX',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 40, 41, 42],
        risk_score: 68,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-31986', cvss: 8.8, severity: 'High', description: 'Axis OS VAPIX command injection vulnerability' }
        ],
        apt_groups: []
    },

    // ==================== INDUSTRIAL OT / ICS ====================
    {
        vendor: 'Siemens AG',
        type: 'PLC',
        model: 'SIMATIC S7-1500 CPU 1516-3 PN/DP',
        vertical: 'industrial',
        name_prefix: 'OT-PLC-S71500',
        ouis: ['00:1b:1b', '00:a0:03', '28:63:36'],
        os_versions: ['SIMATIC Embedded RTOS'],
        firmware_versions: ['V2.9.4'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'SIMATIC-S7-1500',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42],
        risk_score: 92,
        risk_level: 'Critical',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2022-38465', cvss: 9.3, severity: 'Critical', description: 'SIMATIC S7 private key extraction and S7comm hijack' },
            { cve_id: 'CVE-2020-15782', cvss: 9.8, severity: 'Critical', description: 'SIMATIC S7-1500 memory protection bypass' }
        ],
        apt_groups: ['Sandworm Team', 'Xenotime', 'Electrum']
    },
    {
        vendor: 'Rockwell Automation',
        type: 'PLC',
        model: 'ControlLogix 1756-EN2TR',
        vertical: 'industrial',
        name_prefix: 'OT-CLX-ROCKWELL',
        ouis: ['00:00:bc', 'f4:54:33', '5c:88:16'],
        os_versions: ['VxWorks Industrial RTOS'],
        firmware_versions: ['v33.011'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'Rockwell-1756-EN2TR',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 94,
        risk_level: 'Critical',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2021-22681', cvss: 10.0, severity: 'Critical', description: 'Rockwell ControlLogix Studio 5000 authentication bypass' },
            { cve_id: 'CVE-2022-1161', cvss: 10.0, severity: 'Critical', description: 'ControlLogix PLC firmware modification via CIP protocol' }
        ],
        apt_groups: ['Chernovite', 'Dragos PIPEDREAM', 'Sandworm Team']
    },
    {
        vendor: 'FANUC Robotics',
        type: 'Industrial Robot',
        model: 'R-30iB Plus Robot Controller',
        vertical: 'industrial',
        name_prefix: 'OT-ROBOT-FANUC',
        ouis: ['00:e0:e4', '00:09:10'],
        os_versions: ['FANUC System Software'],
        firmware_versions: ['V9.40P/23'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'FANUC-R30iB',
        dhcp_param_req_list: [1, 3, 6, 15],
        risk_score: 81,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2020-14502', cvss: 8.8, severity: 'High', description: 'FANUC R-30iB KAREL web server buffer overflow' }
        ],
        apt_groups: ['Xenotime']
    },
    {
        vendor: 'Schneider Electric',
        type: 'UPS / Power Controller',
        model: 'Smart-UPS SRT 5000 (AP9641)',
        vertical: 'industrial',
        name_prefix: 'OT-UPS-SCHNEIDER',
        ouis: ['00:80:67', '00:c0:b7', '28:29:86'],
        os_versions: ['APC AOS v6.9.6'],
        firmware_versions: ['v6.9.6'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'APC',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42, 43],
        risk_score: 89,
        risk_level: 'Critical',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2022-22805', cvss: 9.8, severity: 'Critical', description: 'TLStorm 2.0 Smart-UPS pre-auth TLS buffer overflow' },
            { cve_id: 'CVE-2022-22806', cvss: 9.0, severity: 'Critical', description: 'TLStorm 2.0 APC NMC authentication bypass' }
        ],
        apt_groups: ['Volt Typhoon']
    },
    {
        vendor: 'Moxa Inc.',
        type: 'Serial-to-Ethernet Gateway',
        model: 'NPort 5150A Industrial Gateway',
        vertical: 'industrial',
        name_prefix: 'OT-GW-MOXA',
        ouis: ['00:90:e8'],
        os_versions: ['Moxa Embedded RTOS'],
        firmware_versions: ['v1.6 Build 21041514'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'Moxa-NPort-5150A',
        dhcp_param_req_list: [1, 3, 6, 12, 15],
        risk_score: 77,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2022-40223', cvss: 8.6, severity: 'High', description: 'Moxa NPort web console stack-based buffer overflow' }
        ],
        apt_groups: ['Sandworm Team']
    },
    {
        vendor: 'JBT Corporation',
        type: 'Automated Guided Vehicle',
        model: 'SGV Automated Guided Vehicle',
        vertical: 'industrial',
        name_prefix: 'OT-AGV-JBT',
        ouis: ['00:0f:3d'],
        os_versions: ['VxWorks 6.9 AGV Control'],
        firmware_versions: ['v8.4.2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp'],
        dhcp_vendor_class_id: 'VxWorks5.5',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 84,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2019-12255', cvss: 9.8, severity: 'Critical', description: 'URGENT/11 VxWorks TCP urgent pointer integer underflow' }
        ],
        apt_groups: []
    },

    // ==================== RETAIL & POS LOGISTICS ====================
    {
        vendor: 'Ingenico Group',
        type: 'POS Terminal',
        model: 'Lane/5000 Payment Terminal',
        vertical: 'retail',
        name_prefix: 'POS-LANE-INGENICO',
        ouis: ['00:08:be', '00:1e:be', '54:7f:54'],
        os_versions: ['Telium TETRA OS'],
        firmware_versions: ['11.24.08.P2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp'],
        dhcp_vendor_class_id: 'Ingenico-TeliumTetra',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42, 43],
        risk_score: 72,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-33558', cvss: 8.1, severity: 'High', description: 'POS payment terminal protocol downgrade vulnerability' }
        ],
        apt_groups: ['FIN7', 'Carbanak']
    },
    {
        vendor: 'Verifone Inc.',
        type: 'POS Terminal',
        model: 'VX820 Payment Terminal',
        vertical: 'retail',
        name_prefix: 'POS-VX-VERIFONE',
        ouis: ['00:0b:4f', '2c:26:5f'],
        os_versions: ['Verifone V/OS (Embedded Linux)'],
        firmware_versions: ['release-30811100'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp'],
        dhcp_vendor_class_id: 'Verifone-VOS',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42],
        risk_score: 69,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2019-19242', cvss: 7.8, severity: 'High', description: 'Embedded POS configuration command injection' }
        ],
        apt_groups: ['FIN7']
    },
    {
        vendor: 'Zebra Technologies',
        type: 'Barcode Label Printer',
        model: 'ZT411 Industrial Printer',
        vertical: 'retail',
        name_prefix: 'LOG-ZEBRA-PRT',
        ouis: ['00:07:4d', '48:a4:93', 'ac:3f:a4'],
        os_versions: ['Zebra Link-OS 6.7'],
        firmware_versions: ['V84.20.23Z'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'mdns', 'ntp'],
        dhcp_vendor_class_id: 'Zebra-LinkOS',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42],
        risk_score: 64,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-38397', cvss: 7.5, severity: 'High', description: 'Zebra Link-OS ZPL unauthenticated settings access' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Mood Media',
        type: 'Digital Signage Player',
        model: 'ProFusion iS Digital Signage',
        vertical: 'retail',
        name_prefix: 'SIGNAGE-PROFUSION',
        ouis: ['f4:4d:30'],
        os_versions: ['Mood Embedded Linux 2.30.0'],
        firmware_versions: ['2.30.0-build418'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'mdns', 'ntp'],
        dhcp_vendor_class_id: 'udhcp 1.24.2',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 61,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2020-11984', cvss: 9.8, severity: 'Critical', description: 'Apache HTTP Server mod_proxy_uwsgi buffer overflow' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Hikvision',
        type: 'IP Camera',
        model: 'DS-2CD2142FWD-I Dome Camera',
        vertical: 'retail',
        name_prefix: 'CAM-HIK-STORE',
        ouis: ['44:19:b6', 'c0:56:e3', 'bc:ad:28'],
        os_versions: ['Embedded Linux 4.9.38'],
        firmware_versions: ['V5.5.82 build 190909'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'mdns', 'ntp', 'ssdp'],
        dhcp_vendor_class_id: 'udhcp 1.19.4',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 95,
        risk_level: 'Critical',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-36260', cvss: 9.8, severity: 'Critical', description: 'Hikvision web server unauthenticated command injection' },
            { cve_id: 'CVE-2017-7921', cvss: 10.0, severity: 'Critical', description: 'Hikvision improper authentication backdoor' }
        ],
        apt_groups: ['Moobot', 'Mirai', 'Volt Typhoon']
    },

    // ==================== SMART BUILDING & CORPORATE ====================
    {
        vendor: 'Johnson Controls',
        type: 'HVAC / BMS Controller',
        model: 'Metasys NAE5510 BMS Controller',
        vertical: 'smart_building',
        name_prefix: 'BMS-METASYS-JCI',
        ouis: ['00:10:8d', '00:50:47'],
        os_versions: ['VxWorks / Windows Embedded'],
        firmware_versions: ['11.0.2.104'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'JCI-Metasys-NAE',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42],
        risk_score: 83,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2021-36198', cvss: 9.1, severity: 'Critical', description: 'Johnson Controls Metasys BACnet API authentication bypass' }
        ],
        apt_groups: []
    },
    {
        vendor: 'LenelS2',
        type: 'Badge Access Controller',
        model: 'OnGuard LNL-4420 Controller',
        vertical: 'smart_building',
        name_prefix: 'ACS-LENEL-DOOR',
        ouis: ['00:06:8e'],
        os_versions: ['Windows 8.1 Embedded'],
        firmware_versions: ['OnGuard 7.6.342'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'ntp'],
        dhcp_vendor_class_id: 'MSFT 5.0',
        dhcp_param_req_list: [1, 15, 3, 6, 44, 46, 47, 31, 33, 249, 43, 252],
        risk_score: 78,
        risk_level: 'High',
        has_ics_cert: true,
        cves: [
            { cve_id: 'CVE-2020-9054', cvss: 9.8, severity: 'Critical', description: 'Physical access control web interface OS command injection' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Signify',
        type: 'Smart Lighting Hub',
        model: 'BSB002 Philips Hue Bridge v2',
        vertical: 'smart_building',
        name_prefix: 'LIGHT-HUE-HUB',
        ouis: ['00:17:88', 'ec:b5:fa'],
        os_versions: ['OpenWrt Embedded Linux'],
        firmware_versions: ['1960062030'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'mdns', 'ntp', 'ssdp'],
        dhcp_vendor_class_id: 'udhcp 1.23.2',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 58,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2020-6007', cvss: 7.9, severity: 'High', description: 'Philips Hue Bridge Zigbee heap-based buffer overflow' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Poly Inc.',
        type: 'Video Conferencing System',
        model: 'Poly Studio X50 Room Bar',
        vertical: 'smart_building',
        name_prefix: 'CONF-POLY-X50',
        ouis: ['64:16:7f', '00:04:f2'],
        os_versions: ['Poly VideoOS 4.1.1'],
        firmware_versions: ['4.1.1-382114'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'mdns', 'ntp'],
        dhcp_vendor_class_id: 'Polycom-StudioX50',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42, 66],
        risk_score: 66,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2022-26478', cvss: 8.8, severity: 'High', description: 'Poly Studio X50 command injection in management portal' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Rhombus Systems',
        type: 'IP Camera',
        model: 'R200 Cloud Dome Camera',
        vertical: 'smart_building',
        name_prefix: 'CAM-RHOMBUS-R200',
        ouis: ['3c:e1:a1'],
        os_versions: ['Rhombus Embedded Linux'],
        firmware_versions: ['2024.08.14.2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'mdns', 'ntp'],
        dhcp_vendor_class_id: 'Rhombus-R200',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 52,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2023-28432', cvss: 7.5, severity: 'High', description: 'Embedded camera telemetry API information disclosure' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Cisco Systems',
        type: 'VoIP Phone',
        model: 'CP-8845 IP Phone',
        vertical: 'smart_building',
        name_prefix: 'VOIP-CISCO-8845',
        ouis: ['f8:7b:20', '00:1b:d4', '70:6e:6d'],
        os_versions: ['Cisco Voice OS'],
        firmware_versions: ['sip8845.12-8-1-0001-455'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'Cisco Systems, Inc. IP Phone CP-8845',
        dhcp_param_req_list: [1, 66, 6, 3, 15, 150, 35],
        risk_score: 65,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2022-20968', cvss: 8.1, severity: 'High', description: 'Cisco IP Phone 8800 Series CDP stack overflow RCE' }
        ],
        apt_groups: []
    },

    // ==================== ENTERPRISE IT & INFRASTRUCTURE ====================
    {
        vendor: 'HP Inc.',
        type: 'Network Printer',
        model: 'LaserJet Enterprise M611dn',
        vertical: 'enterprise',
        name_prefix: 'PRT-HP-LASERJET',
        ouis: ['00:01:e6', '3c:d9:2b', 'b4:b5:2f'],
        os_versions: ['HP FutureSmart LynxOS'],
        firmware_versions: ['2506087_029612'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'mdns', 'ntp', 'ssdp'],
        dhcp_vendor_class_id: 'Hewlett-Packard JetDirect',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42, 43, 81],
        risk_score: 71,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2022-3942', cvss: 8.4, severity: 'High', description: 'HP LaserJet Enterprise Link-Local multicast buffer overflow' }
        ],
        apt_groups: []
    },
    {
        vendor: 'SHARP Corporation',
        type: 'Multifunction Printer',
        model: 'MX-4071 Multifunction Copier',
        vertical: 'enterprise',
        name_prefix: 'MFP-SHARP-MX',
        ouis: ['70:9e:29', '24:77:03'],
        os_versions: ['ThreadX RTOS'],
        firmware_versions: ['05.00.N2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'mdns', 'ntp'],
        dhcp_vendor_class_id: 'SHARP MX-4071',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 42],
        risk_score: 67,
        risk_level: 'Medium',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-38541', cvss: 7.5, severity: 'High', description: 'SHARP MX MFP web administration authentication bypass' }
        ],
        apt_groups: []
    },
    {
        vendor: 'Avigilon',
        type: 'NVR / Video Appliance',
        model: 'ACC7-NVR4-VAL Video Appliance',
        vertical: 'enterprise',
        name_prefix: 'SEC-NVR-AVIGILON',
        ouis: ['b4:96:91', '70:1a:d8'],
        os_versions: ['Windows 8.1/6.10.4.0'],
        firmware_versions: ['6.10.4.0'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'MSFT 5.0',
        dhcp_param_req_list: [1, 15, 3, 6, 44, 46, 47, 31, 33, 249, 43, 252],
        risk_score: 74,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2021-33544', cvss: 8.8, severity: 'High', description: 'Video management server ONVIF stream authentication bypass' }
        ],
        apt_groups: []
    },
    {
        vendor: 'NetApp, Inc.',
        type: 'NAS / SAN Storage',
        model: 'FAS8300 Storage Controller',
        vertical: 'enterprise',
        name_prefix: 'SAN-NETAPP-FAS',
        ouis: ['00:a0:98'],
        os_versions: ['NetApp Data ONTAP 9.12.1P2'],
        firmware_versions: ['9.12.1P2'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'NetApp-ONTAP',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 70,
        risk_level: 'High',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2022-27666', cvss: 7.8, severity: 'High', description: 'NetApp ONTAP IPsec ESP heap buffer overflow' }
        ],
        apt_groups: []
    },
    {
        vendor: 'F5 Networks',
        type: 'Load Balancer / ADC',
        model: 'BIG-IP i4800 Appliance',
        vertical: 'enterprise',
        name_prefix: 'ADC-F5-BIGIP',
        ouis: ['00:23:e9', '00:01:d7'],
        os_versions: ['F5 TMOS 16.1.3.4'],
        firmware_versions: ['16.1.3.4 Build 0.0.5'],
        protocols: ['arp', 'dhcp', 'dns', 'http', 'lldp', 'ntp'],
        dhcp_vendor_class_id: 'F5-BIG-IP',
        dhcp_param_req_list: [1, 3, 6, 12, 15, 28, 42],
        risk_score: 90,
        risk_level: 'Critical',
        has_ics_cert: false,
        cves: [
            { cve_id: 'CVE-2022-1388', cvss: 9.8, severity: 'Critical', description: 'F5 BIG-IP iControl REST unauthenticated RCE' }
        ],
        apt_groups: ['Volt Typhoon', 'APT41']
    }
];

export class IoTCatalogManager {
    private configDir: string;
    private projectRoot: string;
    private catalogPath: string;
    private manufPath: string;
    private db: IoTCatalogDatabase;
    private ouiToVendor: Map<string, string> = new Map();
    private vendorToOuis: Map<string, string[]> = new Map();
    private manufLoaded: boolean = false;

    constructor(configDir: string, projectRoot: string) {
        this.configDir = configDir;
        this.projectRoot = projectRoot;
        this.catalogPath = path.join(configDir, 'iot_catalog.json');
        this.manufPath = path.join(projectRoot, 'iot', 'wireshark_manuf.txt');
        this.loadManufDatabase();
        this.db = this.loadOrInitCatalog();
    }

    private loadManufDatabase(): void {
        if (this.manufLoaded) return;
        this.manufLoaded = true;
        try {
            if (!fs.existsSync(this.manufPath)) return;
            const raw = fs.readFileSync(this.manufPath, 'utf-8');
            const lines = raw.split('\n');
            for (const line of lines) {
                if (!line || line.startsWith('#')) continue;
                const parts = line.split('\t');
                if (parts.length < 2) continue;
                const prefixRaw = parts[0].trim().toLowerCase();
                // Keep standard 24-bit IEEE OUI blocks ("xx:xx:xx")
                if (prefixRaw.length !== 8 || prefixRaw === '00:00:00') continue;
                const shortName = (parts[1] || '').trim();
                const fullName = (parts[2] || shortName).trim();
                if (!fullName) continue;

                if (!this.ouiToVendor.has(prefixRaw)) {
                    this.ouiToVendor.set(prefixRaw, fullName);
                }
                const normKey = fullName.toLowerCase();
                const existing = this.vendorToOuis.get(normKey);
                if (existing) {
                    if (existing.length < 8 && !existing.includes(prefixRaw)) {
                        existing.push(prefixRaw);
                    }
                } else {
                    this.vendorToOuis.set(normKey, [prefixRaw]);
                }
            }
        } catch (err: any) {
            console.error('[IOT-CATALOG] Failed to parse wireshark_manuf.txt:', err.message);
        }
    }

    public lookupVendorByMac(mac: string): string | null {
        if (!mac || mac.length < 8) return null;
        const oui = mac.trim().toLowerCase().slice(0, 8);
        return this.ouiToVendor.get(oui) || null;
    }

    public lookupOuisByVendorKeyword(keyword: string): { vendorName: string; ouis: string[] } | null {
        const kw = keyword.trim().toLowerCase();
        if (!kw || kw.length < 2) return null;
        // Exact prefix or substring match in vendorToOuis
        for (const [vLower, ouis] of this.vendorToOuis.entries()) {
            if (vLower === kw || vLower.startsWith(kw + ' ') || vLower.startsWith(kw + ',') || vLower.includes(' ' + kw)) {
                const canonical = this.ouiToVendor.get(ouis[0]) || keyword;
                return { vendorName: canonical, ouis };
            }
        }
        for (const [vLower, ouis] of this.vendorToOuis.entries()) {
            if (vLower.includes(kw)) {
                const canonical = this.ouiToVendor.get(ouis[0]) || keyword;
                return { vendorName: canonical, ouis };
            }
        }
        return null;
    }

    private makeKey(vendor: string, type: string): string {
        return `${vendor.trim().toLowerCase()}::${type.trim().toLowerCase()}`;
    }

    private inferVertical(vendor: string, type: string, name: string = ''): CatalogArchetype['vertical'] {
        const c = `${vendor} ${type} ${name}`.toLowerCase();
        if (c.includes('baxter') || c.includes('draeger') || c.includes('dräger') || c.includes('health') || c.includes('medical') || c.includes('infusion') || c.includes('patient') || c.includes('mri') || c.includes('dicom') || c.includes('carescape') || c.includes('intellivue')) {
            return 'healthcare';
        }
        if (c.includes('plc') || c.includes('rockwell') || c.includes('fanuc') || c.includes('scada') || c.includes('simatic') || c.includes('agv') || c.includes('jbt') || c.includes('moxa') || c.includes('robot') || c.includes('schneider') || c.includes('ups') || c.includes('industrial')) {
            return 'industrial';
        }
        if (c.includes('ingenico') || c.includes('verifone') || c.includes('pos') || c.includes('zebra') || c.includes('profusion') || c.includes('mood media') || c.includes('signage') || c.includes('payment') || c.includes('retail')) {
            return 'retail';
        }
        if (c.includes('hue') || c.includes('signify') || c.includes('lenel') || c.includes('badge') || c.includes('access control') || c.includes('metasys') || c.includes('johnson controls') || c.includes('hvac') || c.includes('poly') || c.includes('voip') || c.includes('phone') || c.includes('camera') || c.includes('rhombus') || c.includes('hikvision') || c.includes('axis') || c.includes('meraki')) {
            return 'smart_building';
        }
        return 'enterprise';
    }

    private loadOrInitCatalog(): IoTCatalogDatabase {
        try {
            if (fs.existsSync(this.catalogPath)) {
                const parsed = JSON.parse(fs.readFileSync(this.catalogPath, 'utf-8'));
                if (parsed && parsed.archetypes && Object.keys(parsed.archetypes).length > 0) {
                    this.db = parsed;
                    // Ensure curated archetypes are always present
                    let addedCurated = false;
                    for (const item of CURATED_ARCHETYPES) {
                        const key = this.makeKey(item.vendor, item.type);
                        if (!this.db.archetypes[key]) {
                            this.db.archetypes[key] = {
                                ...item,
                                key,
                                source: 'curated-vertical',
                                updated_at: new Date().toISOString()
                            };
                            addedCurated = true;
                        }
                    }
                    if (addedCurated) this.saveCatalog();
                    return this.db;
                }
            }
        } catch (err: any) {
            console.error('[IOT-CATALOG] Error reading iot_catalog.json, rebuilding:', err.message);
        }

        // Seed fresh catalog from CURATED_ARCHETYPES + iot/Sample/iot-devices-sample.json
        this.db = {
            version: '1.0.0',
            updated_at: new Date().toISOString(),
            total_imports: 0,
            archetypes: {}
        };

        const now = new Date().toISOString();
        for (const item of CURATED_ARCHETYPES) {
            const key = this.makeKey(item.vendor, item.type);
            this.db.archetypes[key] = {
                ...item,
                key,
                source: 'curated-vertical',
                updated_at: now
            };
        }

        // Also harvest initial sample devices if present
        const samplePath = path.join(this.projectRoot, 'iot', 'Sample', 'iot-devices-sample.json');
        if (fs.existsSync(samplePath)) {
            try {
                const sampleJson = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
                const sampleDevices = sampleJson.devices || [];
                if (Array.isArray(sampleDevices) && sampleDevices.length > 0) {
                    this.harvestDevices(sampleDevices, 'builtin-sample', false);
                }
            } catch (err: any) {
                console.error('[IOT-CATALOG] Failed to harvest sample JSON:', err.message);
            }
        }

        this.saveCatalog();
        return this.db;
    }

    public saveCatalog(): void {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }
            this.db.updated_at = new Date().toISOString();
            const tmpFile = `${this.catalogPath}.tmp`;
            fs.writeFileSync(tmpFile, JSON.stringify(this.db, null, 2), 'utf-8');
            fs.renameSync(tmpFile, this.catalogPath);
        } catch (err: any) {
            console.error('[IOT-CATALOG] Failed to save iot_catalog.json:', err.message);
        }
    }

    public getStats() {
        const archetypes = Object.values(this.db.archetypes);
        const vendors = new Set<string>();
        const ouis = new Set<string>();
        const cves = new Set<string>();
        const byVertical: Record<string, number> = {
            healthcare: 0,
            industrial: 0,
            retail: 0,
            smart_building: 0,
            enterprise: 0
        };

        for (const a of archetypes) {
            vendors.add(a.vendor.toLowerCase());
            for (const o of a.ouis) ouis.add(o.toLowerCase());
            for (const c of a.cves) cves.add(c.cve_id.toUpperCase());
            byVertical[a.vertical] = (byVertical[a.vertical] || 0) + 1;
        }

        return {
            version: this.db.version,
            updated_at: this.db.updated_at,
            total_imports: this.db.total_imports,
            totals: {
                vendors: vendors.size,
                profiles: archetypes.length,
                ouis: ouis.size,
                cves: cves.size,
                ieee_oui_database: this.ouiToVendor.size
            },
            by_vertical: byVertical,
            archetypes: archetypes.map(a => ({
                key: a.key,
                vendor: a.vendor,
                type: a.type,
                model: a.model,
                vertical: a.vertical,
                ouis_count: a.ouis.length,
                sample_oui: a.ouis[0] || '00:1b:1b',
                os: a.os_versions[0] || 'Embedded Linux',
                firmware: a.firmware_versions[0] || 'v2.4.18',
                cves_count: a.cves.length,
                has_ics_cert: a.has_ics_cert,
                source: a.source
            }))
        };
    }

    /**
     * Harvests devices from any CSV/JSON import, resolves Unknown vendors via IEEE OUI,
     * enriches iot_catalog.json, and returns a "Catalog Harvest Report" ("Bilan de la pêche").
     */
    public harvestDevices(devices: any[], source: string = 'user-import', incrementImportCount: boolean = true): CatalogHarvestReport {
        const existingVendors = new Set<string>();
        const existingOuis = new Set<string>();
        const existingCves = new Set<string>();

        for (const a of Object.values(this.db.archetypes)) {
            existingVendors.add(a.vendor.toLowerCase());
            for (const o of a.ouis) existingOuis.add(o.toLowerCase());
            for (const c of a.cves) existingCves.add(c.cve_id.toUpperCase());
        }

        const newVendorsList: string[] = [];
        const newProfilesList: string[] = [];
        let enrichedProfilesCount = 0;
        let newOuisCount = 0;
        const newCvesSet = new Set<string>();
        let ouiResolvedVendors = 0;
        const touchedExistingKeys = new Set<string>();

        const now = new Date().toISOString();

        for (const d of devices || []) {
            if (!d || typeof d !== 'object') continue;
            const mac = String(d.mac || '').trim().toLowerCase();
            const oui = mac.length >= 8 ? mac.slice(0, 8) : '';

            let vendor = String(d.vendor || '').trim();
            if (!vendor || vendor.toLowerCase() === 'unknown' || vendor.toLowerCase() === 'generic') {
                const resolved = this.lookupVendorByMac(mac);
                if (resolved) {
                    vendor = resolved;
                    d.vendor = resolved; // Enrich the imported device in-place too!
                    ouiResolvedVendors++;
                }
            }
            if (!vendor || vendor.toLowerCase() === 'unknown' || vendor.toLowerCase() === 'generic') {
                continue; // Do not pollute catalog with unresolved Unknown vendors
            }

            const devType = String(d.type || 'IoT Device').trim() || 'IoT Device';
            const key = this.makeKey(vendor, devType);

            // Extract OS
            let osVer = '';
            if (d._vuln_meta?.os && d._vuln_meta.os !== '-') {
                osVer = String(d._vuln_meta.os).trim();
            } else if (typeof d.description === 'string' && d.description.includes('OS:')) {
                const afterOs = d.description.split('OS:')[1] || '';
                osVer = (afterOs.split('|')[0] || '').trim();
            }

            // Extract Firmware
            const fwVer = String(d.firmware || d._vuln_meta?.firmware || '').trim();

            // Extract CVEs
            const extractedCves: CatalogCVEEntry[] = [];
            if (Array.isArray(d._vuln_meta?.top_cves)) {
                for (const c of d._vuln_meta.top_cves) {
                    if (c && c.cve_id) {
                        extractedCves.push({
                            cve_id: String(c.cve_id).toUpperCase(),
                            cvss: Number(c.cvss) || 7.5,
                            severity: String(c.severity || 'High'),
                            description: c.description ? String(c.description) : undefined
                        });
                    }
                }
            }

            if (!existingVendors.has(vendor.toLowerCase())) {
                existingVendors.add(vendor.toLowerCase());
                newVendorsList.push(vendor);
            }

            const existingArch = this.db.archetypes[key];
            if (!existingArch) {
                const cleanPrefix = String(d.name || devType)
                    .toUpperCase()
                    .replace(/[^A-Z0-9-]+/g, '-')
                    .replace(/-\d+$/, '')
                    .slice(0, 18) || 'IOT-DEV';

                const newArch: CatalogArchetype = {
                    key,
                    vendor,
                    type: devType,
                    model: devType,
                    vertical: this.inferVertical(vendor, devType, d.name || ''),
                    name_prefix: cleanPrefix,
                    ouis: oui && oui !== '00:00:00' ? [oui] : [],
                    os_versions: osVer && osVer !== '-' ? [osVer] : [],
                    firmware_versions: fwVer && fwVer !== '-' ? [fwVer] : [],
                    protocols: Array.isArray(d.protocols) && d.protocols.length > 0
                        ? d.protocols
                        : ['arp', 'dhcp', 'dns', 'http', 'ntp'],
                    dhcp_vendor_class_id: String(d.fingerprint?.dhcp?.vendor_class_id || 'udhcp 1.24.2'),
                    dhcp_param_req_list: Array.isArray(d.fingerprint?.dhcp?.param_req_list)
                        ? d.fingerprint.dhcp.param_req_list
                        : [1, 3, 6, 12, 15, 28, 42],
                    risk_score: Number(d._vuln_meta?.risk_score) || 45,
                    risk_level: String(d._vuln_meta?.risk_level || 'Medium'),
                    has_ics_cert: Boolean(d._vuln_meta?.has_ics_cert),
                    cves: extractedCves,
                    apt_groups: Array.isArray(d._vuln_meta?.apt_groups) ? d._vuln_meta.apt_groups.slice(0, 8) : [],
                    source,
                    updated_at: now
                };

                this.db.archetypes[key] = newArch;
                newProfilesList.push(`${vendor} — ${devType}`);

                if (oui && !existingOuis.has(oui)) {
                    existingOuis.add(oui);
                    newOuisCount++;
                }
                for (const c of extractedCves) {
                    if (!existingCves.has(c.cve_id)) {
                        existingCves.add(c.cve_id);
                        newCvesSet.add(c.cve_id);
                    }
                }
            } else {
                let modified = false;
                if (oui && oui !== '00:00:00' && !existingArch.ouis.includes(oui)) {
                    existingArch.ouis.push(oui);
                    modified = true;
                    if (!existingOuis.has(oui)) {
                        existingOuis.add(oui);
                        newOuisCount++;
                    }
                }
                if (osVer && osVer !== '-' && !existingArch.os_versions.includes(osVer)) {
                    existingArch.os_versions.push(osVer);
                    modified = true;
                }
                if (fwVer && fwVer !== '-' && !existingArch.firmware_versions.includes(fwVer)) {
                    existingArch.firmware_versions.push(fwVer);
                    modified = true;
                }
                for (const c of extractedCves) {
                    if (!existingArch.cves.some(ec => ec.cve_id === c.cve_id)) {
                        existingArch.cves.push(c);
                        modified = true;
                    }
                    if (!existingCves.has(c.cve_id)) {
                        existingCves.add(c.cve_id);
                        newCvesSet.add(c.cve_id);
                    }
                }
                if (d._vuln_meta?.has_ics_cert && !existingArch.has_ics_cert) {
                    existingArch.has_ics_cert = true;
                    modified = true;
                }
                if (modified) {
                    existingArch.updated_at = now;
                    if (!touchedExistingKeys.has(key)) {
                        touchedExistingKeys.add(key);
                        enrichedProfilesCount++;
                    }
                }
            }
        }

        if (incrementImportCount) {
            this.db.total_imports = (this.db.total_imports || 0) + 1;
            this.saveCatalog();
        }

        const stats = this.getStats();
        return {
            source,
            scanned_devices: (devices || []).length,
            oui_resolved_vendors: ouiResolvedVendors,
            new_vendors_count: newVendorsList.length,
            new_vendors_list: newVendorsList.slice(0, 12),
            new_profiles_count: newProfilesList.length,
            new_profiles_list: newProfilesList.slice(0, 12),
            enriched_profiles_count: enrichedProfilesCount,
            new_ouis_count: newOuisCount,
            new_cves_count: newCvesSet.size,
            new_cves_sample: Array.from(newCvesSet).slice(0, 12),
            catalog_totals: stats.totals
        };
    }

    private generateUniqueMacForOui(oui: string, usedMacs: Set<string>): string {
        const cleanOui = (oui && oui.length === 8 ? oui : '00:1b:1b').toLowerCase();
        for (let attempt = 0; attempt < 200; attempt++) {
            const b3 = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
            const b4 = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
            const b5 = Math.floor(Math.random() * 254 + 1).toString(16).padStart(2, '0');
            const candidate = `${cleanOui}:${b3}:${b4}:${b5}`;
            if (!usedMacs.has(candidate)) {
                usedMacs.add(candidate);
                return candidate;
            }
        }
        return `${cleanOui}:aa:bb:cc`;
    }

    private parseSemanticPrompt(prompt: string, targetCount: number): {
        title: string;
        vertical: CatalogArchetype['vertical'];
        items: FleetBlueprintItem[];
    } {
        const lower = prompt.toLowerCase();
        let detectedVertical: CatalogArchetype['vertical'] = 'enterprise';
        let title = 'Custom IoT Fleet Scenario';

        if (lower.includes('clinique') || lower.includes('hopital') || lower.includes('hôpital') || lower.includes('hospital') || lower.includes('medical') || lower.includes('médical') || lower.includes('sante') || lower.includes('santé') || lower.includes('healthcare') || lower.includes('irm') || lower.includes('baxter')) {
            detectedVertical = 'healthcare';
            title = '🏥 Clinical & Medical IoMT Fleet';
        } else if (lower.includes('usine') || lower.includes('factory') || lower.includes('industr') || lower.includes('ot') || lower.includes('automate') || lower.includes('plc') || lower.includes('scada') || lower.includes('robot') || lower.includes('fanuc') || lower.includes('rockwell')) {
            detectedVertical = 'industrial';
            title = '🏭 Industrial OT & ICS Production Line';
        } else if (lower.includes('magasin') || lower.includes('retail') || lower.includes('supermarch') || lower.includes('store') || lower.includes('pos') || lower.includes('caisse') || lower.includes('tpe') || lower.includes('ingenico') || lower.includes('verifone') || lower.includes('zebra')) {
            detectedVertical = 'retail';
            title = '🛒 Retail Store & POS Logistics';
        } else if (lower.includes('batiment') || lower.includes('bâtiment') || lower.includes('building') || lower.includes('campus') || lower.includes('bureau') || lower.includes('office') || lower.includes('hvac') || lower.includes('badge') || lower.includes('hue')) {
            detectedVertical = 'smart_building';
            title = '🏢 Smart Building & Campus Automation';
        }

        const allArchetypes = Object.values(this.db.archetypes);
        const matchedItems: FleetBlueprintItem[] = [];
        const matchedKeys = new Set<string>();

        // Keyword synonyms mapping to catalog searches
        const keywordRules: Array<{ keywords: string[]; matchFn: (a: CatalogArchetype) => boolean }> = [
            { keywords: ['baxter', 'pompe', 'infusion', 'perfuseur'], matchFn: a => a.vendor.toLowerCase().includes('baxter') || a.type.toLowerCase().includes('infusion') },
            { keywords: ['irm', 'mri', 'scanner', 'healthineers', 'radiolog'], matchFn: a => a.type.toLowerCase().includes('mri') || a.vendor.toLowerCase().includes('healthineers') },
            { keywords: ['philips', 'intellivue', 'moniteur patient'], matchFn: a => a.vendor.toLowerCase().includes('philips') },
            { keywords: ['ge healthcare', 'carescape', 'ecg'], matchFn: a => a.vendor.toLowerCase().includes('ge ') },
            { keywords: ['draeger', 'dräger', 'anesth'], matchFn: a => a.vendor.toLowerCase().includes('draeger') },
            { keywords: ['axis'], matchFn: a => a.vendor.toLowerCase().includes('axis') },
            { keywords: ['hikvision', 'hik'], matchFn: a => a.vendor.toLowerCase().includes('hikvision') },
            { keywords: ['rhombus'], matchFn: a => a.vendor.toLowerCase().includes('rhombus') },
            { keywords: ['meraki'], matchFn: a => a.vendor.toLowerCase().includes('meraki') },
            { keywords: ['avigilon', 'nvr'], matchFn: a => a.vendor.toLowerCase().includes('avigilon') },
            { keywords: ['camera', 'caméra', 'cctv', 'surveillance'], matchFn: a => a.type.toLowerCase().includes('camera') },
            { keywords: ['siemens', 'simatic', 's7'], matchFn: a => a.vendor.toLowerCase() === 'siemens ag' },
            { keywords: ['rockwell', 'allen-bradley', 'controllogix'], matchFn: a => a.vendor.toLowerCase().includes('rockwell') },
            { keywords: ['fanuc', 'robot'], matchFn: a => a.vendor.toLowerCase().includes('fanuc') },
            { keywords: ['schneider', 'apc', 'onduleur', 'ups'], matchFn: a => a.vendor.toLowerCase().includes('schneider') },
            { keywords: ['moxa', 'serial'], matchFn: a => a.vendor.toLowerCase().includes('moxa') },
            { keywords: ['agv', 'jbt', 'chariot'], matchFn: a => a.vendor.toLowerCase().includes('jbt') },
            { keywords: ['ingenico', 'tpe', 'lane'], matchFn: a => a.vendor.toLowerCase().includes('ingenico') },
            { keywords: ['verifone'], matchFn: a => a.vendor.toLowerCase().includes('verifone') },
            { keywords: ['zebra', 'barcode', 'code-barre', 'etiquette', 'étiquette'], matchFn: a => a.vendor.toLowerCase().includes('zebra') },
            { keywords: ['mood', 'profusion', 'signage', 'affichage'], matchFn: a => a.vendor.toLowerCase().includes('mood') },
            { keywords: ['johnson', 'metasys', 'hvac', 'gtc', 'bms', 'climatisation'], matchFn: a => a.vendor.toLowerCase().includes('johnson') },
            { keywords: ['lenel', 'badge', 'controle d\'acces', 'contrôle d\'accès'], matchFn: a => a.vendor.toLowerCase().includes('lenel') },
            { keywords: ['hue', 'signify', 'eclairage', 'éclairage', 'light'], matchFn: a => a.vendor.toLowerCase().includes('signify') },
            { keywords: ['poly', 'polycom', 'visio', 'conference', 'conférence'], matchFn: a => a.vendor.toLowerCase().includes('poly') },
            { keywords: ['cisco', 'voip', 'telephone', 'téléphone'], matchFn: a => a.vendor.toLowerCase().includes('cisco') },
            { keywords: ['hp ', 'laserjet', 'imprimante', 'printer'], matchFn: a => a.vendor.toLowerCase().includes('hp ') },
            { keywords: ['sharp', 'copieur', 'mfp'], matchFn: a => a.vendor.toLowerCase().includes('sharp') },
            { keywords: ['netapp', 'nas', 'san', 'storage'], matchFn: a => a.vendor.toLowerCase().includes('netapp') },
            { keywords: ['f5', 'big-ip', 'load balancer'], matchFn: a => a.vendor.toLowerCase().includes('f5') }
        ];

        for (const rule of keywordRules) {
            for (const kw of rule.keywords) {
                const idx = lower.indexOf(kw);
                if (idx !== -1) {
                    const arch = allArchetypes.find(rule.matchFn);
                    if (arch && !matchedKeys.has(arch.key)) {
                        matchedKeys.add(arch.key);
                        // Check if a number immediately precedes the keyword (e.g. "8 caméras Axis" or "10 pompes Baxter")
                        const before = lower.slice(Math.max(0, idx - 22), idx);
                        const numMatch = before.match(/(\d+)\s*(?:x\s*)?(?:équipements?|devices?|pompes?|caméras?|cameras?|moniteurs?|automates?|robots?|terminaux|tpe|imprimantes?|postes?)?\s*$/i);
                        const explicitQty = numMatch ? Math.min(targetCount, Math.max(1, parseInt(numMatch[1], 10))) : 0;
                        matchedItems.push({ archetype: arch, count: explicitQty });
                    }
                    break;
                }
            }
        }

        // Fill remaining slots from the detected vertical
        const verticalPool = allArchetypes.filter(a => a.vertical === detectedVertical && !matchedKeys.has(a.key));
        if (matchedItems.length === 0) {
            for (const arch of verticalPool.slice(0, 6)) {
                matchedItems.push({ archetype: arch, count: 0 });
            }
        } else if (matchedItems.length < 4 && verticalPool.length > 0) {
            for (const arch of verticalPool.slice(0, 4 - matchedItems.length)) {
                matchedItems.push({ archetype: arch, count: 0 });
            }
        }

        // Distribute counts to reach exact targetCount
        let allocated = matchedItems.reduce((acc, item) => acc + item.count, 0);
        if (allocated > targetCount) {
            // Scale down proportionally
            const scale = targetCount / allocated;
            allocated = 0;
            for (let i = 0; i < matchedItems.length; i++) {
                matchedItems[i].count = Math.max(1, Math.floor(matchedItems[i].count * scale));
                allocated += matchedItems[i].count;
            }
        }
        const unallocatedItems = matchedItems.filter(i => i.count === 0);
        const remaining = Math.max(0, targetCount - allocated);

        if (unallocatedItems.length > 0 && remaining > 0) {
            const base = Math.floor(remaining / unallocatedItems.length);
            let rem = remaining % unallocatedItems.length;
            for (const item of unallocatedItems) {
                item.count = base + (rem > 0 ? 1 : 0);
                if (rem > 0) rem--;
            }
        } else if (remaining > 0 && matchedItems.length > 0) {
            let idx = 0;
            for (let r = 0; r < remaining; r++) {
                matchedItems[idx % matchedItems.length].count++;
                idx++;
            }
        }

        return {
            title,
            vertical: detectedVertical,
            items: matchedItems.filter(i => i.count > 0)
        };
    }

    public generateFleet(opts: FleetGenerateOptions): FleetGenerateResult {
        const count = Math.min(100, Math.max(1, Number(opts.count) || 30));
        const badBehaviorPct = Math.min(100, Math.max(0, Number(opts.badBehaviorPct ?? 25)));
        const usedMacs = opts.existingMacs ? new Set(opts.existingMacs) : new Set<string>();

        let scenarioTitle = 'Enterprise IoT Fleet';
        let engineMode: FleetGenerateResult['engine_mode'] = 'vertical_preset';
        let blueprintItems: FleetBlueprintItem[] = [];

        const verticalTitles: Record<string, string> = {
            healthcare: '🏥 Clinical & Hospital IoMT Fleet',
            industrial: '🏭 Industrial OT & ICS Production Fleet',
            retail: '🛒 Retail Store & POS Logistics Fleet',
            smart_building: '🏢 Smart Building & Campus Automation',
            enterprise: '🌐 Enterprise IT & Security Infrastructure'
        };

        if (opts.prompt && opts.prompt.trim().length > 2) {
            engineMode = 'semantic_compiler';
            const parsed = this.parseSemanticPrompt(opts.prompt.trim(), count);
            scenarioTitle = parsed.title;
            blueprintItems = parsed.items;
        } else {
            const v = (opts.vertical || 'healthcare').toLowerCase();
            scenarioTitle = verticalTitles[v] || verticalTitles.healthcare;
            const allArch = Object.values(this.db.archetypes);
            let pool = allArch.filter(a => a.vertical === v);
            if (pool.length === 0) pool = allArch.slice(0, 6);
            // Prefer curated archetypes first so vertical presets always have top-tier models
            pool.sort((a, b) => (a.source === 'curated-vertical' ? -1 : 1) - (b.source === 'curated-vertical' ? -1 : 1));
            const selectedPool = pool.slice(0, 6);
            const base = Math.floor(count / selectedPool.length);
            let rem = count % selectedPool.length;
            blueprintItems = selectedPool.map(arch => {
                const c = base + (rem > 0 ? 1 : 0);
                if (rem > 0) rem--;
                return { archetype: arch, count: c };
            }).filter(i => i.count > 0);
        }

        const behaviorTypesPool = [
            ['dns_suspicious', 'pan_url_test'],
            ['port_scan', 'dns_suspicious'],
            ['pan_dns_test', 'credential_spray'],
            ['Beaconing / C2', 'Data Exfiltration'],
            ['pan_url_test', 'Lateral Movement']
        ];

        const generatedDevices: any[] = [];
        const blueprintSummary: FleetGenerateResult['blueprint_summary'] = [];

        // Determine how many devices get bad_behavior enabled
        const targetBadCount = Math.round((count * badBehaviorPct) / 100);
        // Pick deterministic spread indices for bad behavior
        const badIndices = new Set<number>();
        if (targetBadCount > 0) {
            for (let i = 0; i < count && badIndices.size < targetBadCount; i++) {
                const slot = Math.floor((i * count) / targetBadCount);
                badIndices.add(slot < count ? slot : i);
            }
            for (let i = 0; i < count && badIndices.size < targetBadCount; i++) {
                badIndices.add(i);
            }
        }

        let globalIndex = 0;
        const tsSuffix = String(Date.now()).slice(-4);

        for (const item of blueprintItems) {
            const arch = item.archetype;
            const ouis = arch.ouis.length > 0 ? arch.ouis : ['00:1b:1b'];
            const osVer = arch.os_versions[0] || 'Embedded Linux 5.10';
            const fwVer = arch.firmware_versions[0] || 'v2.4.18';

            blueprintSummary.push({
                vendor: arch.vendor,
                type: arch.type,
                model: arch.model || arch.type,
                oui: ouis[0].toUpperCase(),
                os: osVer,
                firmware: fwVer,
                count: item.count
            });

            for (let idx = 1; idx <= item.count; idx++) {
                const chosenOui = ouis[(idx - 1) % ouis.length];
                const mac = this.generateUniqueMacForOui(chosenOui, usedMacs);
                const numStr = String(idx).padStart(2, '0');
                const hostname = `${arch.name_prefix}-${numStr}`;
                const devId = `${arch.name_prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${numStr}_${tsSuffix}`;
                const isBad = badIndices.has(globalIndex);
                const chosenBehaviors = behaviorTypesPool[globalIndex % behaviorTypesPool.length];
                const trafficInterval = 60 + ((globalIndex * 17) % 120); // 60s–180s spread

                const topCvesFormatted = arch.cves.slice(0, 3).map(c => `${c.cve_id} (CVSS ${c.cvss} ${c.severity})`).join(', ');
                const descParts = [
                    `Model: ${arch.model || arch.type}`,
                    `OS: ${osVer}`,
                    `FW: ${fwVer}`,
                    `Risk: ${arch.risk_level} (${arch.risk_score}/100)`
                ];
                if (arch.cves.length > 0) {
                    descParts.push(`Top CVEs: ${topCvesFormatted}`);
                }
                if (arch.has_ics_cert) {
                    descParts.push('⚠️ ICS-CERT alert');
                }

                generatedDevices.push({
                    id: devId,
                    name: hostname,
                    vendor: arch.vendor,
                    type: arch.type,
                    mac,
                    firmware: fwVer,
                    protocols: arch.protocols,
                    enabled: true,
                    traffic_interval: trafficInterval,
                    description: descParts.join(' | '),
                    fingerprint: {
                        dhcp: {
                            hostname,
                            vendor_class_id: arch.dhcp_vendor_class_id,
                            client_id_type: 1,
                            param_req_list: arch.dhcp_param_req_list
                        }
                    },
                    _vuln_meta: {
                        os: osVer,
                        firmware: fwVer,
                        risk_score: arch.risk_score,
                        risk_level: arch.risk_level,
                        cve_count: arch.cves.length,
                        critical_cves: arch.cves.filter(c => c.severity.toLowerCase() === 'critical').length,
                        high_cves: arch.cves.filter(c => c.severity.toLowerCase() === 'high').length,
                        max_cvss: arch.cves.reduce((m, c) => Math.max(m, c.cvss), 0),
                        has_ics_cert: arch.has_ics_cert,
                        apt_groups: arch.apt_groups,
                        top_cves: arch.cves
                    },
                    security: {
                        bad_behavior: isBad,
                        behavior_type: chosenBehaviors
                    }
                });

                globalIndex++;
            }
        }

        return {
            devices: generatedDevices,
            scenario_title: scenarioTitle,
            engine_mode: engineMode,
            blueprint_summary: blueprintSummary
        };
    }
}
