package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"
)

const EngineVersion = "2.2.0-go"

var (
	activeHTTPWorkers atomic.Int32
	activeVoiceCalls  atomic.Int32
	activeEchoFlows   atomic.Int32
	totalHTTPReqs     atomic.Int64
	totalRTPPackets   atomic.Int64
)

type GoEngineMetrics struct {
	EngineVersion     string  `json:"engine_version"`
	PID               int     `json:"pid"`
	UptimeSec         float64 `json:"uptime_sec"`
	Goroutines        int     `json:"goroutines"`
	HeapAllocMB       float64 `json:"heap_alloc_mb"`
	SysMemMB          float64 `json:"sys_mem_mb"`
	NumGC             uint32  `json:"num_gc"`
	ActiveHTTPWorkers int32   `json:"active_http_workers"`
	ActiveVoiceCalls  int32   `json:"active_voice_calls"`
	ActiveEchoFlows   int32   `json:"active_echo_flows"`
	TotalHTTPReqs     int64   `json:"total_http_reqs"`
	TotalRTPPackets   int64   `json:"total_rtp_packets"`
	Timestamp         int64   `json:"timestamp"`
}

func isFeatureFlagEnabled(force bool) bool {
	if force {
		return true
	}
	val := os.Getenv("ENABLE_GO_ENGINE")
	return val != "false" && val != "0"
}

func getConfigDir() string {
	if d := os.Getenv("CONFIG_DIR"); d != "" {
		return d
	}
	if _, err := os.Stat("/app/config"); err == nil {
		return "/app/config"
	}
	return "./config"
}

func getLogDir() string {
	if d := os.Getenv("LOG_DIR"); d != "" {
		return d
	}
	if _, err := os.Stat("/var/log/sdwan-traffic-gen"); err == nil {
		return "/var/log/sdwan-traffic-gen"
	}
	return "./logs"
}

func writeAtomicJSON(path string, v any) error {
	tmp := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeAtomicJSONIndent(path string, v any) error {
	tmp := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func runMetricsReporter(ctx context.Context, startTime time.Time) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	metricsPath := "/tmp/stigix-go-metrics.json"
	for {
		select {
		case <-ctx.Done():
			_ = os.Remove(metricsPath)
			return
		case <-ticker.C:
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			payload := GoEngineMetrics{
				EngineVersion:     EngineVersion,
				PID:               os.Getpid(),
				UptimeSec:         time.Since(startTime).Seconds(),
				Goroutines:        runtime.NumGoroutine(),
				HeapAllocMB:       float64(m.Alloc) / (1024 * 1024),
				SysMemMB:          float64(m.Sys) / (1024 * 1024),
				NumGC:             m.NumGC,
				ActiveHTTPWorkers: activeHTTPWorkers.Load(),
				ActiveVoiceCalls:  activeVoiceCalls.Load(),
				ActiveEchoFlows:   activeEchoFlows.Load(),
				TotalHTTPReqs:     totalHTTPReqs.Load(),
				TotalRTPPackets:   totalRTPPackets.Load(),
				Timestamp:         time.Now().Unix(),
			}
			_ = writeAtomicJSON(metricsPath, payload)
		}
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: stigix-go <daemon|iot|convergence|probe|srt|pcap-capture|pcap-parse|pcap-replay|version> [flags]\n")
		os.Exit(1)
	}

	subcmd := os.Args[1]
	switch subcmd {
	case "version", "--version", "-v":
		fmt.Printf("stigix-go %s (%s/%s)\n", EngineVersion, runtime.GOOS, runtime.GOARCH)
		return

	case "convergence":
		runConvergenceCLI(os.Args[2:])
		return

	case "iot":
		runIoTCLI(os.Args[2:])
		return

	case "probe":
		runProbeCmd(os.Args[2:])
		return

	case "srt":
		runSRTCLI(os.Args[2:])
		return

	case "pcap-capture":
		runPcapCaptureCLI(os.Args[2:])
		return

	case "pcap-parse":
		runPcapParseCLI(os.Args[2:])
		return

	case "pcap-replay":
		runPcapReplayCLI(os.Args[2:])
		return

	case "daemon":
		fs := flag.NewFlagSet("daemon", flag.ExitOnError)
		enableTraffic := fs.Bool("traffic", true, "Run HTTP/S Traffic Generator engine")
		enableVoice := fs.Bool("voice", true, "Run Voice RTP Orchestrator engine")
		enableEcho := fs.Bool("echo", true, "Run UDP Echo & Convergence Responder engine")
		echoPorts := fs.String("echo-ports", "6100,6200", "Comma-separated UDP ports for Echo Server")
		forceFlag := fs.Bool("force", false, "Bypass ENABLE_GO_ENGINE check")
		_ = fs.Parse(os.Args[2:])

		if !isFeatureFlagEnabled(*forceFlag) {
			fmt.Fprintf(os.Stderr, "[STIGIX-GO] Refusing to start: mandatory feature flag ENABLE_GO_ENGINE=true is not set.\n")
			os.Exit(2)
		}

		configDir := getConfigDir()
		logDir := getLogDir()
		_ = os.MkdirAll(configDir, 0755)
		_ = os.MkdirAll(logDir, 0755)
		_ = os.MkdirAll(filepath.Dir("/tmp/stigix-go-metrics.json"), 0755)

		ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer cancel()

		startTime := time.Now()
		fmt.Printf("[STIGIX-GO] Starting native Go engine %s (PID %d) | traffic=%v voice=%v echo=%v\n",
			EngineVersion, os.Getpid(), *enableTraffic, *enableVoice, *enableEcho)

		go runMetricsReporter(ctx, startTime)
		go runProbeRPCServer(ctx, "127.0.0.1:19090")

		if *enableEcho {
			go runEchoServer(ctx, *echoPorts)
		}
		if *enableTraffic {
			go runTrafficEngine(ctx, configDir, logDir)
		}
		if *enableVoice {
			go runVoiceEngine(ctx, configDir, logDir)
		}

		<-ctx.Done()
		fmt.Println("[STIGIX-GO] Shutting down gracefully...")
		time.Sleep(150 * time.Millisecond)

	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand %q. Expected: daemon, iot, convergence, probe, srt, pcap-capture, pcap-parse, pcap-replay, version\n", subcmd)
		os.Exit(1)
	}
}

