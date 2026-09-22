# BR8 → DC1 FAILOVER DEMO

Goal: Simulate a WAN link failure and show live SD-WAN failover, narrated in plain language.

## HOW TO NARRATE
Talk through every real action like a network engineer on a live call.
No tool names, no parameters, no JSON — just short, natural lines:
"Starting the traffic now." / "Cutting the internet link on DC1."
Keep the real timing between steps — don't compress the waits.
You stop the test yourself at the end — don't wait to be told.

## SEQUENCE

### T+0
Look up the BR8 and DC1 endpoints, and BR8's VyOS router/interface for the DC1 link. Then start voice traffic on BR8 and launch a convergence test BR8 → DC1 (profile "conv", UDP 6200). Note the test ID.

### T+15s
Confirm traffic is flowing on the expected path/port.

### T+15s
Inject +200ms latency on the DC1 interface — simulate a degrading link.

### T+45s
Bring that interface fully down — force a real failover.

### T+105s
Bring it back up, clear the injected latency.

### T+135s
Confirm the interface is healthy again; other interfaces' settings untouched.

### T+140s
Pull the failover path history while it's still fresh — use the node's convergence/failover history (not the generic flow browser), which is the reliable source for the actual path transition.

### T+165s
Stop the test yourself, collect final metrics (packets sent/received, loss %, latency, jitter).

### T+170s
Debrief: uplink/downlink loss %, max blackout duration, average latency/jitter, and the exact failover path sequence with timestamps — e.g. "traffic moved off the DC1 primary link onto the DC2 backup link at HH:MM:SS, ~XXXms after the link dropped."

## RULES
Run the sequence start to finish without pausing for confirmation between steps — unless a step fails, in which case stop and report what failed.
