import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import tls from 'tls';
import { log } from './utils/logger.js';

export interface StoredCertificate {
    id: string;
    name: string;
    common_name: string;
    issuer: string;
    algorithm: string;
    valid_from: string;
    valid_to: string;
    is_ca: boolean;
    fingerprint256: string;
    source: 'prisma_auto' | 'manual_upload';
    folder?: string;
    pem: string;
}

export interface CertificateMetadata {
    last_updated: string | null;
    installed: boolean;
    certificates: StoredCertificate[];
}

export class CertificateManager {
    private certDir: string;
    private bundlePath: string;
    private metadataPath: string;
    private metadata: CertificateMetadata = {
        last_updated: null,
        installed: false,
        certificates: []
    };

    constructor(projectRoot: string) {
        this.certDir = path.join(projectRoot, 'config', 'certs');
        this.bundlePath = path.join(this.certDir, 'ca-bundle.pem');
        this.metadataPath = path.join(this.certDir, 'certs-metadata.json');
        this.init();
    }

    public init(): void {
        try {
            if (!fs.existsSync(this.certDir)) {
                fs.mkdirSync(this.certDir, { recursive: true });
            }

            if (fs.existsSync(this.metadataPath)) {
                const raw = fs.readFileSync(this.metadataPath, 'utf8');
                this.metadata = JSON.parse(raw);
            }

            if (fs.existsSync(this.bundlePath) && this.metadata.certificates.length > 0) {
                this.applyCertificatesToRuntime();
            }
        } catch (e: any) {
            log('CERT-MGR', `Error initializing CertificateManager: ${e.message}`, 'error');
        }
    }

    public getStatus() {
        return {
            installed: this.metadata.installed && this.metadata.certificates.length > 0,
            count: this.metadata.certificates.length,
            last_updated: this.metadata.last_updated,
            bundle_path: this.bundlePath,
            certificates: this.metadata.certificates.map(c => ({
                id: c.id,
                name: c.name,
                common_name: c.common_name,
                issuer: c.issuer,
                algorithm: c.algorithm,
                valid_from: c.valid_from,
                valid_to: c.valid_to,
                is_ca: c.is_ca,
                fingerprint256: c.fingerprint256,
                source: c.source,
                folder: c.folder
            }))
        };
    }

    public getBundlePem(): string {
        if (fs.existsSync(this.bundlePath)) {
            return fs.readFileSync(this.bundlePath, 'utf8');
        }
        return '';
    }

    public getCertificatePem(id: string): string | null {
        const cert = this.metadata.certificates.find(c => c.id === id || c.fingerprint256 === id);
        return cert ? cert.pem : null;
    }

    private applyCertificatesToRuntime(): void {
        if (!fs.existsSync(this.bundlePath)) return;

        try {
            // 1. Set environment variables for Node child processes and Python engines
            process.env.NODE_EXTRA_CA_CERTS = this.bundlePath;
            process.env.REQUESTS_CA_BUNDLE = this.bundlePath;
            process.env.SSL_CERT_FILE = this.bundlePath;

            const bundleContent = fs.readFileSync(this.bundlePath, 'utf8');

            // 2. Extend default TLS root certificates in current Node runtime
            const existingRootCerts = tls.rootCertificates || [];
            // Parse certificates from bundle
            const pemBlocks = bundleContent.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
            
            // Reconfigure https.globalAgent
            const combinedCerts = [...existingRootCerts, ...pemBlocks];
            (https.globalAgent as any).options = {
                ...(https.globalAgent as any).options,
                ca: combinedCerts
            };

            log('CERT-MGR', `✓ Custom CA bundle applied to Node & Python runtimes (${this.metadata.certificates.length} certs)`);
        } catch (e: any) {
            log('CERT-MGR', `Failed to apply certificates to runtime: ${e.message}`, 'error');
        }
    }

    private saveState(): void {
        try {
            // Write combined PEM
            const combinedPem = this.metadata.certificates.map(c => c.pem.trim()).join('\n\n') + '\n';
            fs.writeFileSync(this.bundlePath, combinedPem, 'utf8');

            // Write metadata JSON
            fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf8');

            this.applyCertificatesToRuntime();
        } catch (e: any) {
            log('CERT-MGR', `Error saving certificate state: ${e.message}`, 'error');
            throw e;
        }
    }

    /**
     * Automatically fetch Forward-Trust-CA and Root CAs from Prisma Access SASE / SSE API
     */
    public async fetchFromPrisma(creds?: { tsg_id?: string, client_id?: string, client_secret?: string }): Promise<{ success: boolean, count: number, imported: StoredCertificate[], error?: string }> {
        const tsg_id = creds?.tsg_id || process.env.PRISMA_SDWAN_TSGID;
        const client_id = creds?.client_id || process.env.PRISMA_SDWAN_CLIENT_ID;
        const client_secret = creds?.client_secret || process.env.PRISMA_SDWAN_CLIENT_SECRET;

        if (!tsg_id || !client_id || !client_secret) {
            return { success: false, count: 0, imported: [], error: 'Missing Prisma SASE credentials (TSG ID, Client ID, Client Secret)' };
        }

        try {
            log('CERT-MGR', `Authenticating with Palo Alto OAuth for TSG: ${tsg_id}...`);
            
            // 1. Get OAuth Access Token
            const tokenUrl = 'https://auth.apps.paloaltonetworks.com/am/oauth2/access_token';
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', client_id);
            params.append('client_secret', client_secret);
            params.append('scope', `tsg_id:${tsg_id}`);

            const tokenRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                return { success: false, count: 0, imported: [], error: `OAuth Authentication Failed: HTTP ${tokenRes.status} (${errText.substring(0, 100)})` };
            }

            const tokenData = await tokenRes.json() as any;
            const accessToken = tokenData.access_token;
            if (!accessToken) {
                return { success: false, count: 0, imported: [], error: 'OAuth response missing access_token' };
            }

            log('CERT-MGR', '✓ OAuth token obtained. Discovering CA certificates across Prisma Access folders...');

            // 2. Discover certificates across standard Prisma Access folders
            const folders = ['Shared', 'Prisma Access', 'Remote Networks', 'Mobile Users', 'Service Connections'];
            const discoveredCerts: Map<string, any> = new Map();

            for (const folder of folders) {
                try {
                    const certUrl = `https://api.sase.paloaltonetworks.com/sse/config/v1/certificates?folder=${encodeURIComponent(folder)}`;
                    const res = await fetch(certUrl, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (res.ok) {
                        const json = await res.json() as any;
                        const items = json.data || [];
                        for (const item of items) {
                            // Target Forward-Trust-CA, Root CA, or any CA certificate with a public_key PEM
                            const name = item.name || '';
                            const isCA = item.ca === true || name.toLowerCase().includes('forward-trust') || name.toLowerCase().includes('root');
                            if (isCA && item.public_key && typeof item.public_key === 'string' && item.public_key.includes('BEGIN CERTIFICATE')) {
                                const key = `${item.name}-${item.common_name || item.subject_hash || item.id}`;
                                if (!discoveredCerts.has(key)) {
                                    discoveredCerts.set(key, { ...item, _folder: folder });
                                }
                            }
                        }
                    }
                } catch (folderErr: any) {
                    log('CERT-MGR', `Warning querying folder ${folder}: ${folderErr.message}`);
                }
            }

            if (discoveredCerts.size === 0) {
                return { success: false, count: 0, imported: [], error: 'No Forward Trust CA or Root CA certificates found in Prisma Access tenant' };
            }

            // 3. Parse and store discovered certificates
            const newCertificates: StoredCertificate[] = [];
            for (const raw of discoveredCerts.values()) {
                const pem = raw.public_key.trim();
                try {
                    const x509 = new crypto.X509Certificate(pem);
                    
                    // Extract Common Name from subject string
                    const cnMatch = x509.subject.match(/CN=([^/\n,]+)/);
                    const commonName = cnMatch ? cnMatch[1] : (raw.common_name || raw.name);

                    // Extract Issuer CN
                    const issuerMatch = x509.issuer.match(/CN=([^/\n,]+)/);
                    const issuerCn = issuerMatch ? issuerMatch[1] : x509.issuer;

                    const certObj: StoredCertificate = {
                        id: raw.id || crypto.randomUUID(),
                        name: raw.name || commonName,
                        common_name: commonName,
                        issuer: issuerCn,
                        algorithm: raw.algorithm || (x509.publicKey.asymmetricKeyType?.toUpperCase() || 'RSA'),
                        valid_from: x509.validFrom,
                        valid_to: x509.validTo,
                        is_ca: x509.ca,
                        fingerprint256: x509.fingerprint256,
                        source: 'prisma_auto',
                        folder: raw._folder || raw.folder || 'Shared',
                        pem: pem
                    };

                    newCertificates.push(certObj);
                } catch (parseErr: any) {
                    log('CERT-MGR', `Skipping invalid certificate ${raw.name}: ${parseErr.message}`);
                }
            }

            if (newCertificates.length === 0) {
                return { success: false, count: 0, imported: [], error: 'Failed to parse discovered certificates as valid X509' };
            }

            // Merge with existing or replace auto-imported ones
            const manualCerts = this.metadata.certificates.filter(c => c.source === 'manual_upload');
            this.metadata.certificates = [...manualCerts, ...newCertificates];
            this.metadata.installed = this.metadata.certificates.length > 0;
            this.metadata.last_updated = new Date().toISOString();

            this.saveState();

            log('CERT-MGR', `✓ Successfully imported ${newCertificates.length} CA certificates from Prisma Access`);
            return {
                success: true,
                count: newCertificates.length,
                imported: newCertificates
            };
        } catch (e: any) {
            log('CERT-MGR', `Error fetching certificates from Prisma: ${e.message}`, 'error');
            return { success: false, count: 0, imported: [], error: e.message };
        }
    }

    /**
     * Import a certificate manually from raw PEM text or file
     */
    public importManualPem(rawPem: string, customName?: string): { success: boolean, certificate?: StoredCertificate, error?: string } {
        if (!rawPem || !rawPem.includes('BEGIN CERTIFICATE')) {
            return { success: false, error: 'Invalid certificate format. Expected PEM format starting with -----BEGIN CERTIFICATE-----' };
        }

        try {
            const trimmedPem = rawPem.trim();
            const x509 = new crypto.X509Certificate(trimmedPem);

            const cnMatch = x509.subject.match(/CN=([^/\n,]+)/);
            const commonName = cnMatch ? cnMatch[1] : 'Manual CA';

            const issuerMatch = x509.issuer.match(/CN=([^/\n,]+)/);
            const issuerCn = issuerMatch ? issuerMatch[1] : x509.issuer;

            const certObj: StoredCertificate = {
                id: crypto.randomUUID(),
                name: customName || commonName,
                common_name: commonName,
                issuer: issuerCn,
                algorithm: x509.publicKey.asymmetricKeyType?.toUpperCase() || 'RSA',
                valid_from: x509.validFrom,
                valid_to: x509.validTo,
                is_ca: x509.ca,
                fingerprint256: x509.fingerprint256,
                source: 'manual_upload',
                folder: 'Manual',
                pem: trimmedPem
            };

            // Avoid exact fingerprint duplicates
            this.metadata.certificates = this.metadata.certificates.filter(c => c.fingerprint256 !== certObj.fingerprint256);
            this.metadata.certificates.push(certObj);
            this.metadata.installed = true;
            this.metadata.last_updated = new Date().toISOString();

            this.saveState();
            log('CERT-MGR', `✓ Successfully imported manual certificate: ${certObj.name}`);
            return { success: true, certificate: certObj };
        } catch (e: any) {
            log('CERT-MGR', `Failed to parse manual PEM certificate: ${e.message}`, 'error');
            return { success: false, error: `Invalid certificate: ${e.message}` };
        }
    }

    /**
     * Remove a single certificate or clear all
     */
    public deleteCertificate(idOrFingerprint?: string): { success: boolean, remainingCount: number } {
        if (!idOrFingerprint || idOrFingerprint === 'all') {
            this.metadata.certificates = [];
            this.metadata.installed = false;
            this.metadata.last_updated = new Date().toISOString();
        } else {
            this.metadata.certificates = this.metadata.certificates.filter(
                c => c.id !== idOrFingerprint && c.fingerprint256 !== idOrFingerprint
            );
            this.metadata.installed = this.metadata.certificates.length > 0;
            this.metadata.last_updated = new Date().toISOString();
        }

        try {
            if (this.metadata.certificates.length === 0) {
                if (fs.existsSync(this.bundlePath)) fs.unlinkSync(this.bundlePath);
                if (fs.existsSync(this.metadataPath)) fs.unlinkSync(this.metadataPath);
                delete process.env.NODE_EXTRA_CA_CERTS;
                delete process.env.REQUESTS_CA_BUNDLE;
                delete process.env.SSL_CERT_FILE;
            } else {
                this.saveState();
            }
        } catch (e: any) {
            log('CERT-MGR', `Error cleaning up certificate files: ${e.message}`, 'error');
        }

        return { success: true, remainingCount: this.metadata.certificates.length };
    }
}
