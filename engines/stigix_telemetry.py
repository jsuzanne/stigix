#!/usr/bin/env python3
"""
Stigix Python API Telemetry Hook
Hooks into prisma_sase SDK and requests to stream structured API events to the Stigix Web Dashboard.
Zero overhead, fails gracefully if dashboard is unavailable.
"""

import os
import sys
import time
import json
import uuid
from datetime import datetime, timezone
import urllib.request
import urllib.error

SENSITIVE_KEYS = [
    'authorization',
    'x-api-key',
    'client_secret',
    'secret',
    'password',
    'token',
    'access_token',
    'refresh_token',
    'api_key',
    'cookie',
    'set-cookie'
]


def _sanitize(data):
    """Sanitize sensitive keys from dicts and strings."""
    if data is None:
        return None
    if isinstance(data, str):
        if len(data) > 30 and ("Bearer " in data or "Basic " in data):
            return data[:10] + "...***MASKED***"
        return data
    if isinstance(data, list):
        return [_sanitize(x) for x in data]
    if isinstance(data, dict):
        res = {}
        for k, v in data.items():
            if any(sk in k.lower() for sk in SENSITIVE_KEYS):
                res[k] = f"{str(v)[:4]}***MASKED***" if isinstance(v, str) and len(str(v)) > 8 else "***MASKED***"
            else:
                res[k] = _sanitize(v)
        return res
    return data


def _generate_curl(method, url, headers=None, body=None):
    """Generate curl command."""
    curl = f'curl -X {method.upper()} "{url}"'
    if headers:
        for k, v in headers.items():
            if not k.startswith(':') and k.lower() != 'content-length':
                curl += f' \\\n  -H "{k}: {v}"'
    if body and method.upper() not in ('GET', 'HEAD'):
        body_str = body if isinstance(body, str) else json.dumps(body)
        escaped_body = body_str.replace("'", "'\\''")
        curl += f" \\\n  -d '{escaped_body}'"
    return curl


def emit_log_event(
    script_name,
    method,
    url,
    status_code,
    duration_ms,
    request_headers=None,
    request_body=None,
    response_headers=None,
    response_body=None,
    error=None,
    source="python"
):
    """Emits log event to Stigix internal API endpoint or outputs structured tag."""
    port = os.environ.get("STIGIX_PORT", "8080")
    host = os.environ.get("STIGIX_HOST", "127.0.0.1")
    telemetry_url = f"http://{host}:{port}/api/internal/log-event"

    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "scriptName": script_name,
        "direction": "outbound",
        "method": method.upper(),
        "url": url,
        "statusCode": status_code,
        "durationMs": round(duration_ms, 2),
        "requestHeaders": _sanitize(request_headers),
        "requestBody": _sanitize(request_body),
        "responseHeaders": _sanitize(response_headers),
        "responseBody": _sanitize(response_body),
        "error": error,
        "curlSnippet": _generate_curl(method, url, request_headers, request_body)
    }

    # 1. Try sending directly to internal HTTP endpoint
    try:
        data = json.dumps(entry).encode('utf-8')
        req = urllib.request.Request(
            telemetry_url,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=0.3):
            pass
        return
    except Exception:
        pass

    # 2. Fallback: print formatted tag to stdout for parent process to capture if needed
    if os.environ.get("STIGIX_TELEMETRY_STDOUT") == "1":
        sys.stderr.write(f"\n[STIGIX_API_LOG]{json.dumps(entry)}[/STIGIX_API_LOG]\n")
        sys.stderr.flush()


def init_telemetry(script_name="script.py"):
    """
    Automatically patches `prisma_sase` and `requests` if imported to capture all outbound API calls.
    """
    # 1. Hook requests if available
    try:
        import requests
        _original_send = requests.Session.send

        def _hooked_send(self, request, **kwargs):
            start = time.perf_counter()
            resp = None
            err = None
            try:
                resp = _original_send(self, request, **kwargs)
                return resp
            except Exception as e:
                err = str(e)
                raise
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                status_code = resp.status_code if resp is not None else 500
                res_body = None
                res_headers = None
                if resp is not None:
                    res_headers = dict(resp.headers)
                    try:
                        res_body = resp.json()
                    except Exception:
                        res_body = resp.text[:1000] if resp.text else None

                req_body = None
                if request.body:
                    try:
                        req_body = json.loads(request.body)
                    except Exception:
                        req_body = str(request.body)[:1000]

                emit_log_event(
                    script_name=script_name,
                    method=request.method or 'GET',
                    url=request.url,
                    status_code=status_code,
                    duration_ms=duration_ms,
                    request_headers=dict(request.headers) if request.headers else {},
                    request_body=req_body,
                    response_headers=res_headers,
                    response_body=res_body,
                    error=err,
                    source="python"
                )

        requests.Session.send = _hooked_send
    except ImportError:
        pass

    # 2. Hook prisma_sase if available
    try:
        import prisma_sase
        if hasattr(prisma_sase, 'API'):
            _orig_rest_call = prisma_sase.API.rest_call

            def _hooked_rest_call(self, url, method="get", data=None, jsondata=None, params=None, **kwargs):
                start = time.perf_counter()
                resp = None
                err = None
                try:
                    resp = _orig_rest_call(self, url, method=method, data=data, jsondata=jsondata, params=params, **kwargs)
                    return resp
                except Exception as e:
                    err = str(e)
                    raise
                finally:
                    duration_ms = (time.perf_counter() - start) * 1000
                    status_code = 200
                    res_body = None
                    if resp is not None:
                        # prisma_sase rest_call response object
                        status_code = getattr(resp, 'status_code', 200)
                        try:
                            res_body = resp.json()
                        except Exception:
                            res_body = getattr(resp, 'text', '')[:1000]

                    # Resolve full URL if relative
                    full_url = url
                    controller = getattr(self, 'controller', None)
                    if controller and not url.startswith('http'):
                        full_url = f"{controller.rstrip('/')}/{url.lstrip('/')}"

                    req_body = jsondata if jsondata is not None else data

                    emit_log_event(
                        script_name=script_name,
                        method=method.upper(),
                        url=full_url,
                        status_code=status_code,
                        duration_ms=duration_ms,
                        request_headers={"Content-Type": "application/json"},
                        request_body=req_body,
                        response_body=res_body,
                        error=err,
                        source="python"
                    )

            prisma_sase.API.rest_call = _hooked_rest_call
    except ImportError:
        pass
