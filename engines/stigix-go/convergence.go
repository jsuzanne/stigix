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

type convRollingPacket struct {
	ts   float64
	recv int // 1 or 0
}

type convRollingJitter struct {
	ts  float64
	val float64
}

type ConvergenceSeriesPoint struct {
	Ts       int64   `json:"ts"`
	LossPct  float64 `json:"loss_pct"`
	RttMs    float64 `json:"rtt_ms"`
	JitterMs float64 `json:"jitter_ms"`
	TxSent   int64   `json:"tx_sent"`
	RxRecv   int64   `json:"rx_recv"`
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
		mu                  sync.Mutex
		startTime           = time.Now()
		startFloat          = float64(startTime.UnixNano()) / 1e9
		sent                int64
		received            int64
		serverReceived      int64
		lastReceivedSeq     int64 = -1
		rtts                []float64
		currentRtt          float64
		jitter              float64
		lastTransit         float64
		hasLastTransit      bool
		rollingJitter       []convRollingJitter
		rollingPackets      []convRollingPacket
		history             []int
		metricsSeries       []ConvergenceSeriesPoint
		lastRecvTime        = startFloat
		lastTickTime        = startFloat
		lastSeriesTime      = startFloat
		lastBucketSent      int64
		lastBucketRecv      int64
		maxBlackoutMs       float64
		currentBlackoutMs   float64
		inBlackout          bool
		blackoutStart       float64
		warmupSec           = 5.0
		sentRegistry        = make(map[int64]float64)
		accountedSeqs       = make(map[int64]struct{})
		receivedSeqs        = make(map[int64]struct{})
	)

	getEffectiveMaxBlackout := func() float64 {
		val := maxBlackoutMs
		if inBlackout && currentBlackoutMs > val {
			val = currentBlackoutMs
		}
		return round2(val)
	}

	buildStats := func(status string) map[string]any {
		mu.Lock()
		defer mu.Unlock()

		nowFloat := float64(time.Now().UnixNano()) / 1e9
		elapsed := nowFloat - startFloat
		if elapsed < 0.001 {
			elapsed = 0.001
		}

		// Trim 5s rolling windows
		cutoff := nowFloat - 5.0
		idxP := 0
		for idxP < len(rollingPackets) && rollingPackets[idxP].ts < cutoff {
			idxP++
		}
		if idxP > 0 {
			rollingPackets = rollingPackets[idxP:]
		}
		idxJ := 0
		for idxJ < len(rollingJitter) && rollingJitter[idxJ].ts < cutoff {
			idxJ++
		}
		if idxJ > 0 {
			rollingJitter = rollingJitter[idxJ:]
		}

		liveLossPct := 0.0
		if len(rollingPackets) > 0 {
			recSum := 0
			for _, p := range rollingPackets {
				recSum += p.recv
			}
			liveLossPct = float64(len(rollingPackets)-recSum) / float64(len(rollingPackets)) * 100.0
		}

		totalLossPct := 0.0
		if sent > 0 {
			totalLossPct = float64(sent-received) / float64(sent) * 100.0
			if totalLossPct < 0 {
				totalLossPct = 0
			}
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

		var txLossPct, rxLossPct, txLossMs, rxLossMs float64
		var txLostPackets, rxLostPackets int64
		syncLost := sent - received
		if syncLost < 0 {
			syncLost = 0
		}
		intervalMs := 1000.0 / float64(rate)

		if serverReceived > 0 && sent > 0 {
			txLostPackets = sent - serverReceived
			if txLostPackets < 0 {
				txLostPackets = 0
			}
			rxLostPackets = serverReceived - received
			if rxLostPackets < 0 {
				rxLostPackets = 0
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

		// Record 1s series point
		if nowFloat-lastSeriesTime >= 1.0 {
			txDelta := sent - lastBucketSent
			rxDelta := received - lastBucketRecv
			lastBucketSent = sent
			lastBucketRecv = received
			metricsSeries = append(metricsSeries, ConvergenceSeriesPoint{
				Ts:       int64(nowFloat * 1000),
				LossPct:  round2(liveLossPct),
				RttMs:    round2(currentRtt),
				JitterMs: round2(effJitter),
				TxSent:   txDelta,
				RxRecv:   rxDelta,
			})
			if len(metricsSeries) > 300 {
				metricsSeries = metricsSeries[len(metricsSeries)-300:]
			}
			lastSeriesTime = nowFloat
		}

		histCopy := make([]int, len(history))
		copy(histCopy, history)
		seriesCopy := make([]ConvergenceSeriesPoint, len(metricsSeries))
		copy(seriesCopy, metricsSeries)

		currBlk := 0.0
		if inBlackout {
			currBlk = round2(currentBlackoutMs)
		}

		return map[string]any{
			"test_id":             realID,
			"engine":              "stigix-go",
			"status":              status,
			"sent":                sent,
			"received":            received,
			"server_received":     serverReceived,
			"loss_pct":            round2(liveLossPct),
			"live_loss_pct":       round2(liveLossPct),
			"total_loss_pct":      round2(totalLossPct),
			"tx_loss_pct":         txLossPct,
			"rx_loss_pct":         rxLossPct,
			"tx_lost_packets":     txLostPackets,
			"rx_lost_packets":     rxLostPackets,
			"tx_loss_ms":          txLossMs,
			"rx_loss_ms":          rxLossMs,
			"sync_lost":           syncLost,
			"max_blackout_ms":     getEffectiveMaxBlackout(),
			"current_blackout_ms": currBlk,
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

				if inBlackout {
					dur := (recvTime - blackoutStart) * 1000.0
					if recvTime-startFloat >= warmupSec {
						if dur > maxBlackoutMs {
							maxBlackoutMs = dur
						}
					}
					inBlackout = false
					currentBlackoutMs = 0
				}
				lastRecvTime = recvTime
				lastTickTime = recvTime

				if _, acc := accountedSeqs[seq]; !acc {
					accountedSeqs[seq] = struct{}{}
					rollingPackets = append(rollingPackets, convRollingPacket{ts: recvTime, recv: 1})
					history = append(history, 1)
					if len(history) > 100 {
						history = history[len(history)-100:]
					}
				}
				delete(sentRegistry, seq)
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
			sentRegistry[seq] = nowFloat
			mu.Unlock()
			seq++
		}

		// Tick loss / blackout check
		mu.Lock()
		lossTimeout := 0.5
		if currentRtt > 0 {
			cand := (currentRtt / 1000.0) * 3.0
			if cand > 0.25 {
				lossTimeout = cand
			} else {
				lossTimeout = 0.25
			}
		}
		for s, sTime := range sentRegistry {
			if nowFloat-sTime > lossTimeout {
				if _, acc := accountedSeqs[s]; !acc {
					accountedSeqs[s] = struct{}{}
					rollingPackets = append(rollingPackets, convRollingPacket{ts: nowFloat, recv: 0})
					history = append(history, 0)
					if len(history) > 100 {
						history = history[len(history)-100:]
					}
				}
				delete(sentRegistry, s)
			}
		}
		gapFromTick := nowFloat - lastTickTime
		silenceFromRecv := nowFloat - lastRecvTime
		if gapFromTick > 0.3 {
			lastRecvTime += gapFromTick
			if inBlackout {
				blackoutStart += gapFromTick
			}
		} else {
			thresholdS := math.Max(0.2, (1.0/float64(rate))*3.0)
			if silenceFromRecv > thresholdS {
				if !inBlackout {
					inBlackout = true
					blackoutStart = lastRecvTime
				}
				currentBlackoutMs = (nowFloat - blackoutStart) * 1000.0
			}
		}
		lastTickTime = nowFloat
		mu.Unlock()

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

	graceSec := math.Max(0.25, math.Min(1.5, (avgRttMs*3.0)/1000.0))
	time.Sleep(time.Duration(graceSec * float64(time.Second)))

	cancelRecv()
	recvWg.Wait()

	finalStats := buildStats("stopped")
	_ = writeAtomicJSON(statsFile, finalStats)
}
