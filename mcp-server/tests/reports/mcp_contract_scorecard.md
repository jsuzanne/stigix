# MCP Error Contract Scorecard — 2026-09-24T12:22:09.033642+00:00

## Summary

| Status | Count |
|--------|-------|
| ✅ OK | 83 |
| ⚠️ DEGRADED | 0 |
| ❌ KO | 0 |

## Detail

| Tool | Cat | 404 | 500 | empty | nonjson | spa | slow | down | Time(ms) | Size(KB) |
|---|---|---|---|---|---|---|---|---|---|---|
| ✅ add_dem_probe | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6026 | 0.19 |
| ✅ add_fabric_target | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.24 |
| ✅ add_tcp_app_peer | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8001 | 0.49 |
| ✅ clone_node_config | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8009 | 1.02 |
| ✅ compare_nodes | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8001 | 0.42 |
| ✅ create_custom_tcp_app | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8000 | 0.43 |
| ✅ delete_custom_tcp_app | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6018 | 0.47 |
| ✅ export_app_config | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.21 |
| ✅ generate_peer_onboard_command | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3013 | 0.44 |
| ✅ generate_report | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8000 | 0.43 |
| ✅ get_app_score | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3022 | 0.2 |
| ✅ get_controller_status | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3026 | 0.42 |
| ✅ get_convergence_history | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.19 |
| ✅ get_convergence_report | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.22 |
| ✅ get_dem_probe_stats | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8002 | 0.13 |
| ✅ get_dem_summary | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.2 |
| ✅ get_diagnostics | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3012 | 0.2 |
| ✅ get_health_matrix | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.43 |
| ✅ get_node_status | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8001 | 0.31 |
| ✅ get_prisma_flows | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3027 | 0.41 |
| ✅ get_probe_details | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3019 | 0.2 |
| ✅ get_provisioning_history | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.19 |
| ✅ get_provisioning_status | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.16 |
| ✅ get_public_ip | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.07 |
| ✅ get_security_config | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6019 | 0.08 |
| ✅ get_security_results_stats | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3022 | 0.25 |
| ✅ get_security_test_options | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.19 |
| ✅ get_security_test_options_dynamic | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ get_server_info | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | 0.08 |
| ✅ get_tcp_app_sessions | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6019 | 0.26 |
| ✅ get_test_status | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 2 | 0.04 |
| ✅ get_traffic_logs | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3025 | 0.41 |
| ✅ get_traffic_stats | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6026 | 0.19 |
| ✅ get_voice_ingress_calls | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3019 | 0.41 |
| ✅ get_voice_stats | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.4 |
| ✅ get_vyos_interfaces | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.19 |
| ✅ get_vyos_router_state | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3019 | 0.24 |
| ✅ get_vyos_timeline | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3014 | 0.2 |
| ✅ import_app_config | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.2 |
| ✅ list_active_impairments | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3027 | 0.17 |
| ✅ list_apps | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3019 | 0.19 |
| ✅ list_controller_peers | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.42 |
| ✅ list_custom_tcp_apps | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.44 |
| ✅ list_dem_probes | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ list_endpoints | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 22 | 0.73 |
| ✅ list_fabric_targets | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 13 | 0.83 |
| ✅ list_security_results | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3019 | 0.2 |
| ✅ list_speedtest_history | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3021 | 0.18 |
| ✅ list_vyos_routers | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ list_vyos_scenarios | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3014 | 0.19 |
| ✅ publish_configuration_bundle | dest | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8001 | 0.45 |
| ✅ purge_stale_leader_state | dest | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.27 |
| ✅ remove_dem_probe | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ remove_fabric_target | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 14 | 0.12 |
| ✅ reset_tcp_app_metrics | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6020 | 0.49 |
| ✅ rollback_configuration_bundle | dest | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.53 |
| ✅ run_dem_probes_now | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.19 |
| ✅ run_eicar_test | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6041 | 0.2 |
| ✅ run_full_security_audit | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8000 | 0.88 |
| ✅ run_path_trace | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.35 |
| ✅ run_security_dns_batch | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3034 | 0.23 |
| ✅ run_security_probe | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 9 | 0.06 |
| ✅ run_security_url_batch | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3013 | 0.23 |
| ✅ run_system_diagnostics | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.45 |
| ✅ run_test | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3023 | 0.46 |
| ✅ run_vyos_scenario | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.21 |
| ✅ set_controller_leader | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3015 | 0.43 |
| ✅ set_fabric_target_enabled | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 12 | 0.12 |
| ✅ set_provisioning_mode | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.43 |
| ✅ set_traffic_client_count | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3023 | 0.19 |
| ✅ set_traffic_rate | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ set_traffic_status | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.19 |
| ✅ set_voice_status | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3017 | 0.19 |
| ✅ set_vyos_scenario_status | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3016 | 0.19 |
| ✅ start_tcp_app_listener | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6021 | 0.5 |
| ✅ start_tcp_app_workload | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6015 | 0.49 |
| ✅ stop_tcp_app_listener | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6020 | 0.49 |
| ✅ stop_tcp_app_workload | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6025 | 0.49 |
| ✅ stop_test | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 2 | 0.06 |
| ✅ test_tcp_app_handshake | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6023 | 0.47 |
| ✅ update_dem_probe | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3013 | 0.08 |
| ✅ vyos_bulk_reset | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 3018 | 0.24 |
| ✅ vyos_execute_action | writ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8001 | 0.24 |
