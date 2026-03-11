#!/bin/bash

BASE_URL="https://stigix-registry.jlsuzanne.workers.dev"

for p in {1..3}; do
  POC_ID="77700${p}"
  echo "--- Seeding PoC: $POC_ID ---"
  
  for i in {1..5}; do
    INSTANCE_ID="stigix-node-0${i}"
    
    echo "Registering $INSTANCE_ID for PoC $POC_ID..."
    
    curl -s -X POST "$BASE_URL/register" \
      -H "Content-Type: application/json" \
      -d "{
        \"poc_id\": \"$POC_ID\",
        \"instance_id\": \"$INSTANCE_ID\",
        \"type\": \"docker\",
        \"ip_private\": \"10.$p.0.$i\",
        \"capabilities\": {\"voice\": true, \"iperf\": true},
        \"meta\": {
          \"site\": \"SITE-0$i\",
          \"region\": \"Region-$p\",
          \"version\": \"1.2.1\"
        }
      }"
    echo ""
  done
done

echo "Done seeding."
