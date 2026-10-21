package main

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"net"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type convRollingJitter struct {
	ts  float64
	val float64
}

type ConvergenceSeriesPoint struct {
	Time         string  `json:"time"`
	TimeLabel    string  `json:"timeLabel"`
	ElapsedLabel string  `json:"elapsedLabel"`
	ElapsedSec   int64   `json:"elapsedSec"`
	Ts           int64   `json:"ts"`
	Rtt          float64 `json:"rtt"`
	Jitter       float64 `json:"jitter"`
	Loss         float64 `json:"loss"`
	LossPct      float64 `json:"loss_pct"`
	RttMs        float64 `json:"rtt_ms"`
	JitterMs     float64 `json:"jitter_ms"`
	TxSent       int64   `json:"tx_sent"`
	RxRecv       int64   `json:"rx_recv"`
}

var (
	reConvIDNum = regexp.MustCompile(`CONV-(\d+)`)
	reTestIDNum = regexp.MustCompile(`TEST-(\d+)`)
)

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func runConvergenceCLI(args []string) {
	target := ""
	port := 6200
	rate := 50
	rawID := fmt.Sprintf("CONV-%d", time.Now().Unix())
	statsFile := "/tmp/convergence_stats.json"
	duration := 0
	forceFlag := false

	// Manual flag parser to support both single-dash (-dport, -D, -C) and double-dash (--target, --port, etc.)
	for i := 0; i < len(args); i++ {
		arg := args[i]
		nextVal := func() string {
			if i+1 < len(args) {
				i++
				return args[i]
			}
			return ""
		}
		switch arg {
		case "--target", "-D":
			target = nextVal()
		case "--port", "-dport":
			if v, err := strconv.Atoi(nextVal()); err == nil {
				port = v
			}
		case "--rate", "-C":
			if v, err := strconv.Atoi(nextVal()); err == nil {
				rate = v
			}
		case "--id":
			rawID = nextVal()
		case "--stats-file":
			statsFile = nextVal()
		case "--duration":
			if v, err := strconv.Atoi(nextVal()); err == nil {
				duration = v
			}
		case "--force":
			forceFlag = true
		}
	}

	if !isFeatureFlagEnabled(forceFlag) {
		fmt.Fprintf(os.Stderr, "[STIGIX-GO CONVERGENCE] Refusing to start: mandatory feature flag ENABLE_GO_ENGINE=true is not set.\n")
		os.Exit(2)
	}

	if target == "" {
		fmt.Fprintf(os.Stderr, "[STIGIX-GO CONVERGENCE] Error: --target is required\n")
		os.Exit(1)
	}
	if rate < 1 {
		rate = 50
	}

	realID := rawID
	label := "Convergence"
	if strings.Contains(rawID, " (") && strings.HasSuffix(rawID, ")") {
		parts := strings.SplitN(rawID, " (", 2)
		realID = parts[0]
		label = strings.TrimSuffix(parts[1], ")")
	}

	sourcePort := 0
	if m := reConvIDNum.FindStringSubmatch(realID); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil {
			sourcePort = 30000 + (n % 10000)
		}
	} else if m := reTestIDNum.FindStringSubmatch(realID); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil && len(m[1]) <= 4 {
			sourcePort = 30000 + (n % 10000)
		}
	}
	if sourcePort == 0 {
		sourcePort = 40000 + rand.Intn(20000)
	}

	raddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("%s:%d", target, port))
	if err != nil {
		fmt.Fprintf(os.Stderr, "[STIGIX-GO CONVERGENCE] Resolve error for %s:%d: %v\n", target, port, err)
		os.Exit(1)
	}

	laddr := &net.UDPAddr{IP: net.IPv4zero, Port: sourcePort}
	conn, err := net.DialUDP("udp4", laddr, raddr)
	if err != nil {
		laddr.Port = 0
		conn, err = net.DialUDP("udp4", laddr, raddr)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "[STIGIX-GO CONVERGENCE] Socket error: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()

	if localUDP, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		sourcePort = localUDP.Port
	}
	applySocketOptions(conn, "", 0, 4*1024*1024, 4*1024*1024)

	var (
		mu              sync.Mutex
		startTime       = time.Now()
		startFloat      = float64(startTime.UnixNano()) / 1e9
		sent            int64
		received        int64
		serverReceived  int64
		lastReceivedSeq int64 = -1
		rtts            []float64
		currentRtt      float64
		jitter          float64
		lastTransit     float64
		hasLastTransit  bool
		rollingJitter   []convRollingJitter
		metricsSeries   []ConvergenceSeriesPoint
		lastRecvTime    = startFloat
		lastSeriesTime  = startFloat
		lastBucketSent  int64
		lastBucketRecv  int64
		warmupSec       = 1.0
		sentTimes       []float64
		receivedFlags   []bool
		receivedSeqs    = make(map[int64]struct{})
	)

	buildStats := func(status string) map[string]any {
		mu.Lock()
		defer mu.Unlock()

		now := time.Now()
		nowFloat := float64(now.UnixNano()) / 1e9
		elapsed := nowFloat - startFloat
		if elapsed < 0.001 {
			elapsed = 0.001
		}
		isRunning := (status == "running")

		// Trim 5s rolling jitter window
		cutoff := nowFloat - 5.0
		idxJ := 0
		for idxJ < len(rollingJitter) && rollingJitter[idxJ].ts < cutoff {
			idxJ++
		}
		if idxJ > 0 {
			rollingJitter = rollingJitter[idxJ:]
		}

		effJitter := jitter
		if len(rollingJitter) > 0 {
			jSum := 0.0
			for _, j := range rollingJitter {
				jSum += j.val
			}
			effJitter = jSum / float64(len(rollingJitter))
		}

		avgRtt := 0.0
		if len(rtts) > 0 {
			startIdx := 0
			if len(rtts) > 50 {
				startIdx = len(rtts) - 50
			}
			sub := rtts[startIdx:]
			sum := 0.0
			for _, v := range sub {
				sum += v
			}
			avgRtt = sum / float64(len(sub))
		}

		// Jitter-tolerant in-flight grace window (minimum 1.0s during live tests)
		// Prevents delayed packets on WAN/lab links from triggering false drops or false blackouts
		// while still detecting real SD-WAN tunnel failovers accurately.
		inFlightGraceSec := math.Max(1.0, (avgRtt/1000.0)*4.0+(effJitter/1000.0)*6.0)
		totalSent := int64(len(sentTimes))

		// Recompute self-healing 100-packet sequence history dynamically from actual receivedFlags
		histCopy := make([]int, 0, 100)
		histStart := totalSent - 100
		if histStart < 0 {
			histStart = 0
		}
		for s := histStart; s < totalSent; s++ {
			if receivedFlags[s] {
				histCopy = append(histCopy, 1)
			} else if isRunning && (nowFloat-sentTimes[s] <= inFlightGraceSec) {
				// Packet is still within the in-flight / jitter grace window
				histCopy = append(histCopy, 1)
			} else {
				histCopy = append(histCopy, 0)
			}
		}
		if len(histCopy) < 100 {
			pad := make([]int, 100-len(histCopy))
			for i := range pad {
				pad[i] = 1
			}
			histCopy = append(pad, histCopy...)
		}

		// Compute self-healing live loss percentage over the last 5s of resolved packets
		liveLossPct := 0.0
		if isRunning && totalSent > 0 {
			resolvedCount := 0
			lostCount := 0
			for s := totalSent - 1; s >= 0; s-- {
				sTime := sentTimes[s]
				if sTime < cutoff {
					break
				}
				if receivedFlags[s] {
					resolvedCount++
				} else if nowFloat-sTime > inFlightGraceSec {
					resolvedCount++
					lostCount++
				}
			}
			if resolvedCount > 0 {
				liveLossPct = float64(lostCount) / float64(resolvedCount) * 100.0
			}
		}

		totalLossPct := 0.0
		if sent > 0 {
			totalLossPct = float64(sent-received) / float64(sent) * 100.0
			if totalLossPct < 0 {
				totalLossPct = 0
			}
		}

		// Compute maxBlackoutMs and currentBlackoutMs strictly from contiguous runs of confirmed lost/overdue packets.
		// If 100% of packets arrived (pure jitter delay with 0 lost packets), maxBlackoutMs is guaranteed to be 0ms.
		intervalMs := 1000.0 / float64(rate)
		computedMaxBlackoutMs := 0.0
		computedCurrentBlackoutMs := 0.0

		if !isRunning && received >= sent {
			computedMaxBlackoutMs = 0.0
			computedCurrentBlackoutMs = 0.0
			for i := range histCopy {
				histCopy[i] = 1
			}
		} else if totalSent > 0 {
			runStart := int64(-1)
			for s := int64(0); s < totalSent; s++ {
				isLost := false
				if !receivedFlags[s] {
					if !isRunning || (nowFloat-sentTimes[s] > inFlightGraceSec) {
						isLost = true
					}
				}
				if isLost {
					if runStart == -1 {
						runStart = s
					}
				} else if runStart != -1 {
					runEnd := s - 1
					durMs := (sentTimes[runEnd]-sentTimes[runStart])*1000.0 + intervalMs
					// Ignore isolated single-packet drop during initial 1s warmup
					if sentTimes[runEnd]-startFloat >= warmupSec || (runEnd-runStart+1) >= 2 {
						if durMs > computedMaxBlackoutMs {
							computedMaxBlackoutMs = durMs
						}
					}
					runStart = -1
				}
			}
			// Check if we are currently in an active open-ended blackout at the tail of the stream
			if runStart != -1 {
				tailEnd := totalSent - 1
				// Find the latest overdue packet in this open run
				lastOverdue := runStart
				for s := tailEnd; s >= runStart; s-- {
					if !receivedFlags[s] && (!isRunning || (nowFloat-sentTimes[s] > inFlightGraceSec)) {
						lastOverdue = s
						break
					}
				}
				var openDurMs float64
				if isRunning && lastRecvTime <= sentTimes[runStart] {
					openDurMs = (nowFloat - sentTimes[runStart]) * 1000.0
				} else {
					openDurMs = (sentTimes[lastOverdue]-sentTimes[runStart])*1000.0 + intervalMs
				}
				if isRunning {
					computedCurrentBlackoutMs = openDurMs
				}
				if openDurMs > computedMaxBlackoutMs {
					computedMaxBlackoutMs = openDurMs
				}
			}
		}

		var txLossPct, rxLossPct, txLossMs, rxLossMs float64
		var txLostPackets, rxLostPackets int64
		syncLost := sent - received
		if syncLost < 0 {
			syncLost = 0
		}

		if serverReceived > 0 && sent > 0 {
			if serverReceived < received {
				txLostPackets = 0
				rxLostPackets = syncLost
			} else {
				txLostPackets = sent - serverReceived
				if txLostPackets < 0 {
					txLostPackets = 0
				}
				rxLostPackets = serverReceived - received
				if rxLostPackets < 0 {
					rxLostPackets = 0
				}
			}
			txLossPct = round2(float64(txLostPackets) / float64(sent) * 100.0)
			rxLossPct = round2(float64(rxLostPackets) / float64(serverReceived) * 100.0)
			txLossMs = round2(float64(txLostPackets) * intervalMs)
			rxLossMs = round2(float64(rxLostPackets) * intervalMs)
		} else {
			txLostPackets = syncLost
			txLossPct = round2(totalLossPct)
			txLossMs = round2(float64(syncLost) * intervalMs)
		}

		// Record 1s series point with full Failover.tsx chart schema
		if isRunning && (nowFloat-lastSeriesTime >= 0.95) {
			txDelta := sent - lastBucketSent
			rxDelta := received - lastBucketRecv
			lastBucketSent = sent
			lastBucketRecv = received

			timeLabel := now.Format("15:04:05")
			elSec := int64(math.Round(elapsed))
			elapsedLabel := fmt.Sprintf("%02d:%02d", elSec/60, elSec%60)
			rttVal := round2(currentRtt)
			if rttVal <= 0 {
				rttVal = round2(avgRtt)
			}
			jitterVal := round2(effJitter)
			lossVal := round2(liveLossPct)

			metricsSeries = append(metricsSeries, ConvergenceSeriesPoint{
				Time:         timeLabel,
				TimeLabel:    timeLabel,
				ElapsedLabel: elapsedLabel,
				ElapsedSec:   elSec,
				Ts:           int64(nowFloat * 1000),
				Rtt:          rttVal,
				Jitter:       jitterVal,
				Loss:         lossVal,
				LossPct:      lossVal,
				RttMs:        rttVal,
				JitterMs:     jitterVal,
				TxSent:       txDelta,
				RxRecv:       rxDelta,
			})
			if len(metricsSeries) > 3600 {
				metricsSeries = metricsSeries[len(metricsSeries)-3600:]
			}
			lastSeriesTime = nowFloat
		}

		// If test finished with 0% total loss, ensure any transient in-flight loss spike in metricsSeries is cleared
		if !isRunning && received >= sent {
			for i := range metricsSeries {
				metricsSeries[i].Loss = 0
				metricsSeries[i].LossPct = 0
			}
		}

		seriesCopy := make([]ConvergenceSeriesPoint, len(metricsSeries))
		copy(seriesCopy, metricsSeries)

		displayLossPct := round2(liveLossPct)
		if !isRunning {
			displayLossPct = round2(totalLossPct)
		}

		return map[string]any{
			"test_id":             realID,
			"engine":              "stigix-go",
			"status":              status,
			"sent":                sent,
			"received":            received,
			"server_received":     serverReceived,
			"loss_pct":            displayLossPct,
			"live_loss_pct":       round2(liveLossPct),
			"total_loss_pct":      round2(totalLossPct),
			"tx_loss_pct":         txLossPct,
			"rx_loss_pct":         rxLossPct,
			"tx_lost_packets":     txLostPackets,
			"rx_lost_packets":     rxLostPackets,
			"tx_loss_ms":          txLossMs,
			"rx_loss_ms":          rxLossMs,
			"sync_lost":           syncLost,
			"max_blackout_ms":     round2(computedMaxBlackoutMs),
			"current_blackout_ms": round2(computedCurrentBlackoutMs),
			"avg_rtt_ms":          round2(avgRtt),
			"current_rtt_ms":      round2(currentRtt),
			"jitter_ms":           round2(effJitter),
			"rate_pps":            rate,
			"duration_s":          int64(elapsed),
			"history":             histCopy,
			"metrics_series":      seriesCopy,
			"start_time":          int64(startFloat),
			"target":              target,
			"port":                port,
			"label":               label,
			"source_port":         sourcePort,
			"warmup_s":            warmupSec,
		}
	}

	ctx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	recvCtx, cancelRecv := context.WithCancel(context.Background())
	var recvWg sync.WaitGroup
	recvWg.Add(1)

	// Receiver Goroutine
	go func() {
		defer recvWg.Done()
		buf := make([]byte, 2048)
		for {
			select {
			case <-recvCtx.Done():
				return
			default:
			}
			_ = conn.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
			n, err := conn.Read(buf)
			if err != nil {
				continue
			}
			recvTime := float64(time.Now().UnixNano()) / 1e9
			msg := string(buf[:n])
			if !strings.HasPrefix(msg, "CONV:") {
				continue
			}
			parts := strings.Split(msg, ":")
			if len(parts) < 5 {
				continue
			}
			seq, err1 := strconv.ParseInt(parts[3], 10, 64)
			sendTime, err2 := strconv.ParseFloat(parts[4], 64)
			if err1 != nil || err2 != nil {
				continue
			}
			var sCount int64
			for _, p := range parts[5:] {
				if strings.HasPrefix(p, "S") {
					if sc, err := strconv.ParseInt(p[1:], 10, 64); err == nil {
						sCount = sc
					}
				}
			}

			mu.Lock()
			if _, dup := receivedSeqs[seq]; !dup {
				receivedSeqs[seq] = struct{}{}
				received++
				if seq >= 0 && int(seq) < len(receivedFlags) {
					receivedFlags[seq] = true
				}
				if sCount > serverReceived {
					serverReceived = sCount
				}
				rtt := (recvTime - sendTime) * 1000.0
				if rtt < 0 {
					rtt = 0
				}
				currentRtt = rtt
				rtts = append(rtts, rtt)
				if len(rtts) > 200 {
					rtts = rtts[len(rtts)-200:]
				}
				transit := rtt / 2.0
				if hasLastTransit {
					d := math.Abs(transit - lastTransit)
					jitter += (d - jitter) / 16.0
				}
				lastTransit = transit
				hasLastTransit = true
				rollingJitter = append(rollingJitter, convRollingJitter{ts: recvTime, val: jitter})

				lastRecvTime = recvTime
				if seq > lastReceivedSeq {
					lastReceivedSeq = seq
				}
			}
			mu.Unlock()
		}
	}()

	// Transmitter & Periodic Reporter Loop
	var seq int64
	lastStatsWrite := time.Now()
	rampDuration := 5.0
	startRate := 10.0
	if float64(rate) < startRate {
		startRate = float64(rate)
	}

	for {
		select {
		case <-ctx.Done():
			goto shutdown
		default:
		}

		now := time.Now()
		nowFloat := float64(now.UnixNano()) / 1e9
		elapsed := nowFloat - startFloat

		if duration > 0 && elapsed >= float64(duration) {
			break
		}

		var currentTargetRate float64
		if elapsed < rampDuration {
			currentTargetRate = startRate + (float64(rate)-startRate)*(elapsed/rampDuration)
		} else {
			currentTargetRate = float64(rate)
		}
		interval := time.Duration(float64(time.Second) / currentTargetRate)

		payload := fmt.Sprintf("CONV:%s:%s:%d:%.6f", realID, label, seq, nowFloat)
		if _, err := conn.Write([]byte(payload)); err == nil {
			mu.Lock()
			sent++
			_, alreadyRecv := receivedSeqs[seq]
			sentTimes = append(sentTimes, nowFloat)
			receivedFlags = append(receivedFlags, alreadyRecv)
			mu.Unlock()
			seq++
		}

		if time.Since(lastStatsWrite) >= 200*time.Millisecond {
			st := buildStats("running")
			_ = writeAtomicJSON(statsFile, st)
			lastStatsWrite = time.Now()
		}

		select {
		case <-ctx.Done():
			goto shutdown
		case <-time.After(interval):
		}
	}

shutdown:
	mu.Lock()
	avgRttMs := 50.0
	if len(rtts) > 0 {
		sum := 0.0
		for _, v := range rtts {
			sum += v
		}
		avgRttMs = sum / float64(len(rtts))
	}
	mu.Unlock()

	// Wait up to maxGraceSec for in-flight packets to return, exiting early as soon as received >= sent
	maxGraceSec := math.Max(1.0, math.Min(2.5, (avgRttMs*6.0)/1000.0))
	graceDeadline := time.Now().Add(time.Duration(maxGraceSec * float64(time.Second)))
	for time.Now().Before(graceDeadline) {
		mu.Lock()
		allArrived := received >= sent
		mu.Unlock()
		if allArrived {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	cancelRecv()
	recvWg.Wait()

	finalStats := buildStats("stopped")
	_ = writeAtomicJSON(statsFile, finalStats)
}
