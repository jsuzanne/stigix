# MCP Error Contract Scorecard — 2026-09-23T21:00:54.449198+00:00

## Summary

| Status | Count |
|--------|-------|
| ✅ OK | 81 |
| ⚠️ DEGRADED | 0 |
| ❌ KO | 0 |

## Detail

| Tool | Cat | 404 | 500 | empty | nonjson | spa | slow | down | Time(ms) | Size(KB) |
|---|---|---|---|---|---|---|---|---|---|---|
| ✅ add_dem_probe | writ | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ add_fabric_target | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.24 |
| ✅ add_tcp_app_peer | writ | — | — | ✅ | ✅ | ✅ | — | — | 18 | 0.21 |
| ✅ clone_node_config | writ | — | — | ✅ | ✅ | ✅ | — | — | 20 | 0.44 |
| ✅ compare_nodes | read | — | — | ✅ | ✅ | ✅ | — | — | 25 | 0.42 |
| ✅ create_custom_tcp_app | writ | — | — | ✅ | ✅ | ✅ | — | — | 18 | 0.19 |
| ✅ delete_custom_tcp_app | writ | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.2 |
| ✅ export_app_config | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ generate_peer_onboard_command | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ generate_report | read | — | — | ✅ | ✅ | ✅ | — | — | 34 | 0.43 |
| ✅ get_app_score | read | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.05 |
| ✅ get_controller_status | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ get_convergence_history | read | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.05 |
| ✅ get_dem_probe_stats | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ get_dem_summary | read | — | — | ✅ | ✅ | ✅ | — | — | 16 | 0.05 |
| ✅ get_diagnostics | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ get_health_matrix | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ get_node_status | read | — | — | ✅ | ✅ | ✅ | — | — | 16 | 0.31 |
| ✅ get_prisma_flows | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ get_probe_details | read | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.05 |
| ✅ get_provisioning_history | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.19 |
| ✅ get_provisioning_status | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.16 |
| ✅ get_public_ip | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ get_security_config | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ get_security_results_stats | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.22 |
| ✅ get_security_test_options | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ get_security_test_options_dynamic | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ get_tcp_app_sessions | read | — | — | ✅ | ✅ | ✅ | — | — | 15 | 0.14 |
| ✅ get_test_status | read | — | — | ✅ | ✅ | ✅ | — | — | 2 | 0.04 |
| ✅ get_traffic_logs | read | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.19 |
| ✅ get_traffic_stats | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.19 |
| ✅ get_voice_ingress_calls | read | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.18 |
| ✅ get_voice_stats | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.17 |
| ✅ get_vyos_interfaces | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ get_vyos_router_state | read | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.08 |
| ✅ get_vyos_timeline | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ import_app_config | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.09 |
| ✅ list_active_impairments | read | — | — | ✅ | ✅ | ✅ | — | — | 18 | 0.17 |
| ✅ list_apps | read | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.05 |
| ✅ list_controller_peers | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ list_custom_tcp_apps | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ list_dem_probes | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ list_endpoints | read | — | — | ✅ | ✅ | ✅ | — | — | 20 | 0.73 |
| ✅ list_fabric_targets | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.83 |
| ✅ list_security_results | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ list_speedtest_history | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ list_vyos_routers | read | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ list_vyos_scenarios | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ publish_configuration_bundle | dest | — | — | ✅ | ✅ | ✅ | — | — | 27 | 0.04 |
| ✅ purge_stale_leader_state | dest | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.27 |
| ✅ remove_dem_probe | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ remove_fabric_target | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.12 |
| ✅ reset_tcp_app_metrics | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.19 |
| ✅ rollback_configuration_bundle | dest | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.21 |
| ✅ run_dem_probes_now | writ | — | — | ✅ | ✅ | ✅ | — | — | 16 | 0.05 |
| ✅ run_eicar_test | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.05 |
| ✅ run_full_security_audit | writ | — | — | ✅ | ✅ | ✅ | — | — | 34 | 0.46 |
| ✅ run_path_trace | read | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.35 |
| ✅ run_security_dns_batch | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.09 |
| ✅ run_security_probe | writ | — | — | ✅ | ✅ | ✅ | — | — | 8 | 0.06 |
| ✅ run_security_url_batch | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.09 |
| ✅ run_system_diagnostics | read | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.18 |
| ✅ run_test | writ | — | — | ✅ | ✅ | ✅ | — | — | 19 | 0.26 |
| ✅ run_vyos_scenario | writ | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ set_controller_leader | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ set_fabric_target_enabled | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.12 |
| ✅ set_provisioning_mode | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.18 |
| ✅ set_traffic_client_count | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.08 |
| ✅ set_traffic_rate | writ | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.05 |
| ✅ set_traffic_status | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ set_voice_status | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.05 |
| ✅ set_vyos_scenario_status | writ | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.05 |
| ✅ start_tcp_app_listener | writ | — | — | ✅ | ✅ | ✅ | — | — | 16 | 0.19 |
| ✅ start_tcp_app_workload | writ | — | — | ✅ | ✅ | ✅ | — | — | 14 | 0.19 |
| ✅ stop_tcp_app_listener | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.19 |
| ✅ stop_tcp_app_workload | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.19 |
| ✅ stop_test | writ | — | — | ✅ | ✅ | ✅ | — | — | 2 | 0.06 |
| ✅ test_tcp_app_handshake | writ | — | — | ✅ | ✅ | ✅ | — | — | 13 | 0.19 |
| ✅ update_dem_probe | writ | — | — | ✅ | ✅ | ✅ | — | — | 12 | 0.05 |
| ✅ vyos_bulk_reset | writ | — | — | ✅ | ✅ | ✅ | — | — | 11 | 0.08 |
| ✅ vyos_execute_action | writ | — | — | ✅ | ✅ | ✅ | — | — | 424 | 0.11 |
