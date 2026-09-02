import struct, os, re

# Simulate rtp.py payload creation
call_id = "CALL-0661"
payload_size = 160
payload_padding = os.urandom(payload_size)
call_id_tag = f"CID:{call_id}:".encode('utf-8')
final_payload = (call_id_tag + payload_padding)[:payload_size]

rtp_header = struct.pack('!BBHII', 0x80, 8, 1, 1000, 12345)
data = rtp_header + final_payload

print("Raw data length:", len(data))
print("Raw data sample:", data[:30])

# Test 1: utf-8 decode with ignore
try:
    s_utf8 = data.decode('utf-8', errors='ignore')
    print("UTF-8 decoded:", s_utf8[:40])
    print("CID in utf8?", "CID:" in s_utf8)
    if "CID:" in s_utf8:
        print("Extracted ID (utf8):", s_utf8.split("CID:")[1].split(":")[0])
except Exception as e:
    print("UTF-8 error:", e)

# Test 2: latin-1 decode
try:
    s_latin = data.decode('latin-1', errors='ignore')
    print("Latin-1 decoded:", s_latin[:40])
    print("CID in latin1?", "CID:" in s_latin)
    if "CID:" in s_latin:
        print("Extracted ID (latin1):", s_latin.split("CID:")[1].split(":")[0])
except Exception as e:
    print("Latin-1 error:", e)
