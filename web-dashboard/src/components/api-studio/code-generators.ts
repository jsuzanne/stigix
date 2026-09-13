import type { AutoAuthType } from '../../types/api-studio';

export function generateCurlCode(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: any,
    autoAuth: AutoAuthType = 'none'
): string {
    let curl = `curl -X ${method.toUpperCase()} "${url}"`;

    if (autoAuth === 'sase') {
        curl += ` \\\n  -H "Authorization: Bearer $PRISMA_ACCESS_TOKEN"`;
        curl += ` \\\n  -H "X-PAN-TSG-ID: $PRISMA_TSG_ID"`;
    } else if (autoAuth === 'vyos') {
        curl += ` \\\n  -H "key: $VYOS_API_KEY"`;
    } else if (autoAuth === 'stigix') {
        curl += ` \\\n  -H "Authorization: Bearer $STIGIX_JWT_TOKEN"`;
    }

    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'authorization' && autoAuth !== 'none') continue;
        curl += ` \\\n  -H "${k}: ${v}"`;
    }

    if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        const str = typeof body === 'object' ? JSON.stringify(body, null, 2) : String(body);
        curl += ` \\\n  -d '${str.replace(/'/g, "'\\''")}'`;
    }

    return curl;
}

export function generatePythonRequestsCode(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: any,
    autoAuth: AutoAuthType = 'none'
): string {
    const lines: string[] = [
        'import requests',
        'import json',
        '',
        `url = "${url}"`,
        'headers = {'
    ];

    if (autoAuth === 'sase') {
        lines.push('    "Authorization": "Bearer YOUR_PRISMA_TOKEN",');
        lines.push('    "X-PAN-TSG-ID": "YOUR_TSG_ID",');
    } else if (autoAuth === 'vyos') {
        lines.push('    "key": "YOUR_VYOS_API_KEY",');
    } else if (autoAuth === 'stigix') {
        lines.push('    "Authorization": "Bearer YOUR_STIGIX_TOKEN",');
    }

    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'authorization' && autoAuth !== 'none') continue;
        lines.push(`    "${k}": "${v}",`);
    }
    lines.push('}');

    if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        const bodyStr = typeof body === 'object' ? JSON.stringify(body, null, 4) : JSON.stringify(body);
        lines.push(`payload = ${bodyStr}`);
        lines.push('');
        lines.push(`response = requests.${method.toLowerCase()}(url, headers=headers, json=payload, timeout=15)`);
    } else {
        lines.push('');
        lines.push(`response = requests.${method.toLowerCase()}(url, headers=headers, timeout=15)`);
    }

    lines.push('print("Status:", response.status_code)');
    lines.push('print("Response:", response.json() if "application/json" in response.headers.get("content-type", "") else response.text)');

    return lines.join('\n');
}

export function generatePrismaSasePythonCode(
    method: string,
    url: string,
    body?: any
): string {
    const relUrl = url.replace(/^https?:\/\/[^/]+/, '');
    const bodyStr = body ? JSON.stringify(body, null, 4) : 'None';

    return `from prisma_sase import API

# Initialize Prisma SASE SDK (auto-reads credentials.json or prisma-config.json)
sdk = API()
sdk.interactive.login()

endpoint = "${relUrl}"
payload = ${bodyStr}

# Execute REST call via official Prisma SASE SDK
response = sdk.rest_call(
    url=endpoint,
    method="${method.toLowerCase()}",
    jsondata=payload
)

print("Status:", getattr(response, 'status_code', 200))
print("Data:", response.json() if hasattr(response, 'json') else response)
`;
}

export function generateNodeFetchCode(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: any,
    autoAuth: AutoAuthType = 'none'
): string {
    const finalHeaders: Record<string, string> = { ...headers };
    if (autoAuth === 'sase') {
        finalHeaders['Authorization'] = 'Bearer YOUR_PRISMA_TOKEN';
        finalHeaders['X-PAN-TSG-ID'] = 'YOUR_TSG_ID';
    } else if (autoAuth === 'vyos') {
        finalHeaders['key'] = 'YOUR_VYOS_API_KEY';
    } else if (autoAuth === 'stigix') {
        finalHeaders['Authorization'] = 'Bearer YOUR_STIGIX_TOKEN';
    }

    const hasBody = body !== undefined && body !== null && !['GET', 'HEAD'].includes(method.toUpperCase());
    if (hasBody && !finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
    }

    const lines: string[] = [
        `const url = "${url}";`,
        `const options = {`,
        `  method: "${method.toUpperCase()}",`,
        `  headers: ${JSON.stringify(finalHeaders, null, 4)},`,
    ];

    if (hasBody) {
        lines.push(`  body: JSON.stringify(${typeof body === 'object' ? JSON.stringify(body, null, 4) : JSON.stringify(body)})`);
    }

    lines.push(`};`);
    lines.push(``);
    lines.push(`try {`);
    lines.push(`  const res = await fetch(url, options);`);
    lines.push(`  const data = await res.json();`);
    lines.push(`  console.log("Status:", res.status, data);`);
    lines.push(`} catch (err) {`);
    lines.push(`  console.error("API error:", err);`);
    lines.push(`}`);

    return lines.join('\n');
}
