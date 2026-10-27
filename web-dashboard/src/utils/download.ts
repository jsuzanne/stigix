/**
 * Reliable file download helper that avoids Chrome's `blob:<origin>/<UUID>` filename bug
 * by staging the payload on the local Express server and triggering a native HTTP download
 * with `Content-Disposition: attachment; filename="..."` and a matching URL path segment.
 * Falls back to a delayed-revoke Blob download only if the server endpoint is unreachable.
 */
export async function triggerFileDownload(
    content: string | object,
    filename: string,
    mimeType: string = 'application/json'
): Promise<void> {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/system/prepare-download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                content: serialized,
                filename: safeFilename,
                mimeType
            })
        });

        if (res.ok) {
            const data = await res.json();
            if (data && data.downloadUrl) {
                const a = document.createElement('a');
                a.href = data.downloadUrl;
                a.download = safeFilename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    if (document.body.contains(a)) {
                        document.body.removeChild(a);
                    }
                }, 5000);
                return;
            }
        }
    } catch {
        // Fallback to delayed-revoke Blob below
    }

    const blob = new Blob([serialized], { type: `${mimeType};charset=utf-8` });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        if (document.body.contains(a)) {
            document.body.removeChild(a);
        }
        window.URL.revokeObjectURL(url);
    }, 60000);
}
